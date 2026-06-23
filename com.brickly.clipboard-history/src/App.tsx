import clsx from 'clsx'
import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Search,
  Star,
  Trash2,
  Copy,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
  X,
  Type,
  Image as ImageIcon,
  FileText,
  FolderOpen,
  Database,
  Cpu,
  Layers,
  Sparkles,
  ClipboardList,
  Folder,
  File,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react'
import type { ClipItem, ClipType, ClipboardContent, WatcherStatus } from './types'

/**
 * Premium Glassmorphism UI
 * 极致优雅的玻璃拟态剪贴板，带有霓虹呼吸灯、科幻信息看板与流畅动画。
 */

type FilterId = 'all' | ClipType | 'favorite'

const FILTERS: ReadonlyArray<{ id: FilterId; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'all', label: '全部', icon: ClipboardList },
  { id: 'text', label: '文本', icon: Type },
  { id: 'image', label: '图像', icon: ImageIcon },
  { id: 'file', label: '文件', icon: FileText },
  { id: 'favorite', label: '收藏', icon: Star }
]

const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

export function App() {
  const store = window.clipboardHistoryStore
  const platform = window.clipboardHistoryPlatform ?? window.AIBricks?.platform
  const [items, setItems] = useState<ClipItem[]>([])
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('初始化')
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null)
  const [storageInfoData, setStorageInfoData] = useState<StorageInfoLike | null>(null)
  const [toast, setToast] = useState('')
  const [colophonOpen, setColophonOpen] = useState(false)
  const [imagePreview, setImagePreview] = useState<ClipItem | null>(null)

  const notify = (text: string): void => {
    setToast(text)
    window.setTimeout(() => setToast(''), 1600)
  }

  const refresh = async (): Promise<void> => {
    const next = store ? await store.list() : []
    setItems(next)
    setSelectedId((current) => current ?? next[0]?.id ?? null)
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => {
      if (filter === 'favorite' && !item.favorite) return false
      if (filter !== 'all' && filter !== 'favorite' && item.type !== filter) return false
      if (!needle) return true
      return [
        item.title,
        item.preview,
        item.text,
        item.mimeType,
        item.path,
        item.imagePath,
        item.imageOriginalPath,
        ...(item.paths ?? [])
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .includes(needle)
    })
  }, [filter, items, query])

  useEffect(() => {
    if (selectedId && filtered.some((item) => item.id === selectedId)) return
    setSelectedId(filtered[0]?.id ?? null)
  }, [filtered, selectedId])

  useEffect(() => {
    if (!imagePreview) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setImagePreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [imagePreview])

  useEffect(() => {
    if (!store || !platform) {
      setStatusText(`接口未就绪 · store=${Boolean(store)} platform=${Boolean(platform)}`)
      return
    }

    let alive = true
    let lastTopId: string | null = null
    const unsubscribe = store.subscribe((_event, next) => {
      if (!alive) return
      setItems(next)
      setSelectedId((current) => current ?? next[0]?.id ?? null)
      // 只在首条真的变了的时候提示，避免 plugin/preload 上游被绕过时
      // 反复 toast。
      const topId = next[0]?.id ?? null
      if (topId !== lastTopId) {
        lastTopId = topId
        if (topId) notify('已归档到剪贴板')
        setStatusText(`已归档 · ${next.length}`)
      }
    })

    ;(async () => {
      await refresh()
      try {
        await refreshStorageSnapshot()
        setStatusText('读取宿主监听中...')
        const status = await platform.clipboard.status()
        if (status) setWatcherStatus(status)
        setStatusText(statusSummary(status))
        if (status?.enabled) await captureNow(true)
      } catch (error) {
        setStatusText(`初始化失败 · ${errorMessage(error)}`)
        notify(errorMessage(error))
      }
    })()

    return () => {
      alive = false
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshStorageSnapshot(): Promise<StorageInfoLike | null> {
    if (!store) return null
    let info: unknown = null
    if (store.refreshStorageInfo) info = await store.refreshStorageInfo()
    else info = store.storageInfo()
    setStorageInfoData(toStorageInfo(info))
    return toStorageInfo(info)
  }

  async function captureNow(silent = false): Promise<void> {
    try {
      if (!silent) setStatusText('抓取剪贴板中...')
      const result = await platform?.clipboard.captureNow()
      setWatcherStatus((current) => ({ ...(current ?? {}), ...(result ?? {}) }))
      const changed = result?.lastEventKind ? `已抓取 ${result.lastEventKind}` : '无新内容'
      setStatusText(result ? statusSummary(result, changed) : changed)
      if (!silent) notify('已强制同步剪贴板')
    } catch (error) {
      setStatusText(`抓取失败 · ${errorMessage(error)}`)
      notify(errorMessage(error))
    }
  }

  async function copyItem(item: ClipItem): Promise<void> {
    try {
      await platform?.clipboard.setContent(clipboardContentForItem(item))
      notify(copySuccessText(item))
    } catch (error) {
      notify(`写入剪贴板失败 · ${errorMessage(error)}`)
    }
  }

  async function toggleFavorite(item: ClipItem): Promise<void> {
    if (!store) return
    await store.toggleFavorite(item.id)
    await refresh()
  }

  async function removeItem(item: ClipItem): Promise<void> {
    if (!store) return
    await store.remove(item.id)
    await refresh()
    notify('已彻底移除历史记录')
  }

  const stats = {
    all: items.length,
    text: items.filter((it) => it.type === 'text').length,
    image: items.filter((it) => it.type === 'image').length,
    file: items.filter((it) => it.type === 'file').length,
    favorite: items.filter((it) => it.favorite).length
  }

  const watcherDot = watcherDotClass(watcherStatus)

  return (
    <main className="app-bg grid h-screen grid-rows-[auto_1fr_auto] overflow-hidden select-none">
      {/* ────── TOP: search + filter chips ────── */}
      <div className="topbar">
        <div className="search">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文本 / 文件路径 / 文件类型"
            spellCheck={false}
          />
        </div>
        <nav className="filters">
          {FILTERS.map((entry) => {
            const count = stats[entry.id as keyof typeof stats]
            const active = filter === entry.id
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                className={clsx('chip', active && 'chip-active')}
                onClick={() => setFilter(entry.id)}
                title={`${entry.label} · ${count}`}
              >
                <Icon size={12} className="shrink-0" />
                <span>{entry.label}</span>
                <span className="chip-count">{count}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* ────── BODY: rows ────── */}
      <div className="min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list-container">
            {filtered.map((item, idx) => (
              <Row
                key={item.id}
                item={item}
                index={idx + 1}
                active={selectedId === item.id}
                onSelect={() => setSelectedId(item.id)}
                onCopy={() => copyItem(item)}
                onFavorite={() => toggleFavorite(item)}
                onRemove={() => removeItem(item)}
                onPreviewImage={() => setImagePreview(item)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ────── BOTTOM: status ────── */}
      <div className="statusbar">
        <div className="statusbar__left">
          <span className="inline-flex items-center gap-2">
            <span className={watcherDot} />
            <span className="label">状态</span>
            <span className="val">{watcherStatus?.state === 'running' ? '监听中' : '未就绪'}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="label">总条目</span>
            <span className="val">{items.length}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="label">已收藏</span>
            <span className="val">{stats.favorite}</span>
          </span>
        </div>
        <div className="statusbar__center">
          <span
            className="path cursor-pointer"
            title={statusText + (storageInfoData?.dbPath ? ' · ' + storageInfoData.dbPath : '')}
            onClick={async () => {
              await refreshStorageSnapshot()
              setColophonOpen(true)
            }}
          >
            {storageInfoData?.dbPath ? truncatePath(storageInfoData.dbPath) : statusText}
          </span>
        </div>
        <div className="statusbar__right">
          <button className="sb-btn" title="立即同步系统剪贴板" onClick={() => captureNow(false)}>
            <RefreshCw size={12} className="hover:rotate-180 transition-transform duration-500" />
          </button>
          <button
            className="sb-btn"
            title="查看存储与运行时状态"
            onClick={async () => {
              await refreshStorageSnapshot()
              setColophonOpen(true)
            }}
          >
            <Info size={12} />
          </button>
        </div>
      </div>

      {/* ────── DIALOGS ────── */}
      {colophonOpen && (
        <Dialog
          data={{
            store: storageInfoData,
            watcher: watcherStatus,
            api: { store: Boolean(store), platform: Boolean(platform) }
          }}
          onClose={() => setColophonOpen(false)}
        />
      )}
      {imagePreview && (
        <ImagePreviewDialog item={imagePreview} onClose={() => setImagePreview(null)} />
      )}
      
      {/* ────── TOAST ────── */}
      <div className={clsx('toast', toast && 'toast-visible')}>
        <Sparkles size={13} className="animate-pulse" />
        <span>{toast}</span>
      </div>
    </main>
  )
}

/* ─────────────────────────  ROW  ───────────────────────── */

function Row({
  item,
  index,
  active,
  onSelect,
  onCopy,
  onFavorite,
  onRemove,
  onPreviewImage
}: {
  item: ClipItem
  index: number
  active: boolean
  onSelect: () => void
  onCopy: () => void
  onFavorite: () => void
  onRemove: () => void
  onPreviewImage: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [fileIconUrl, setFileIconUrl] = useState<string | null>(null)
  const [iconsMap, setIconsMap] = useState<Record<string, string>>({})
  const imagePath = item.imagePath || item.imageOriginalPath || item.path
  const filePaths = useMemo(
    () => (item.type === 'file' ? normalizedFilePaths(item) : []),
    [item]
  )
  const fileCount = filePaths.length
  const body = item.text || item.preview || item.path || ''
  const charCount = item.type === 'text' ? (item.text?.length ?? 0) : body.length
  const canExpand =
    item.type === 'file'
      ? filePaths.length > 3
      : item.type !== 'image' &&
        ((item.text?.split(/\r?\n/).length ?? 0) > 2 ||
          (item.text?.length ?? 0) > 180)

  useEffect(() => {
    if (item.type !== 'file') return
    const platformApp = window.clipboardHistoryPlatform?.app ?? window.AIBricks?.platform?.app
    if (!platformApp?.getFileIcon) return

    let alive = true
    if (filePaths.length === 1 && filePaths[0]) {
      platformApp.getFileIcon(filePaths[0])
        .then((url: string) => {
          if (alive && url) setFileIconUrl(url)
        })
        .catch((err: unknown) => console.warn('[App] getFileIcon err', err))
    } else if (filePaths.length > 1) {
      filePaths.forEach((path) => {
        platformApp.getFileIcon(path)
          .then((url: string) => {
            if (alive && url) {
              setIconsMap((prev) => ({ ...prev, [path]: url }))
            }
          })
          .catch((err: unknown) => console.warn('[App] getSubFileIcon err', err))
      })
    }

    return () => {
      alive = false
    }
  }, [filePaths, item.type])

  const fileTitle = useMemo(() => {
    if (item.type !== 'file') return ''
    if (filePaths.length > 1) return `${filePaths.length} 个文件`
    return fileBaseName(filePaths[0]) || '未命名文件'
  }, [filePaths, item.type])
  const visibleFilePaths = expanded ? filePaths : filePaths.slice(0, 3)

  return (
    <li className={clsx('row', active && 'row-active')} onClick={onSelect} onDoubleClick={onCopy}>
      <div className="row__body">
        {/* 类型 1：单文件 —— 大系统图标与带下划线文件名链接，无余赘控件 */}
        {item.type === 'file' && filePaths.length === 1 && (
          <div className="flex items-center gap-2.5 w-full my-0.5 min-w-0">
            {/* 高清大图标 */}
            <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
              {fileIconUrl ? (
                <img src={fileIconUrl} alt="" className="w-6.5 h-6.5 object-contain" />
              ) : (
                isLikelyDirectory(filePaths[0]) ? (
                  <Folder size={18} className="text-amber-400 fill-amber-400/10 shrink-0" />
                ) : (
                  <File size={18} className="text-slate-300 shrink-0" />
                )
              )}
            </div>
            {/* 下划线链接文件名 */}
            <span className="file-link-title" title={filePaths[0]}>
              {fileTitle}
            </span>
          </div>
        )}

        {/* 类型 2：多文件 —— 直接极简扁平呈现 VSCode Explorer 缩进列表 */}
        {item.type === 'file' && filePaths.length > 1 && (
          <div className={clsx('file-list', expanded && 'file-list--full')}>
            {visibleFilePaths.map((path) => {
              const isDir = isLikelyDirectory(path)
              const subIconUrl = iconsMap[path]
              return (
                <div className="file-list__row" key={path} title={path}>
                  {subIconUrl ? (
                    <img src={subIconUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
                  ) : isDir ? (
                    <Folder size={15} className="text-amber-400 fill-amber-400/15 shrink-0" />
                  ) : (
                    <File size={15} className="text-slate-300 shrink-0" />
                  )}
                  <span className="file-list__name">{fileBaseName(path)}</span>
                </div>
              )
            })}

          </div>
        )}

        {/* 类型 2：图像 —— 居中显示 */}
        {item.type === 'image' && imagePath && (
          <div className="flex flex-col items-center w-full my-1">
            <button
              className="figure-center"
              onClick={(event) => {
                event.stopPropagation()
                onPreviewImage()
              }}
              title="点击查看大图"
            >
              <img src={fileUrl(imagePath)} alt="" loading="lazy" />
            </button>
          </div>
        )}

        {/* 类型 3：文本 —— 靠最左侧直排大字正文 */}
        {item.type === 'text' && (
          <div className={clsx('row__content font-sans text-[13.5px] font-semibold text-slate-100 pl-0.5 tracking-wide leading-relaxed', expanded && 'row__content--full')}>
            {expanded ? body : item.preview || body || '— 空内容 —'}
          </div>
        )}

        {/* 极致精炼的底签工具栏 (与截图高度一致：左时间，右元数据，最右是序号) */}
        <div className="row__footer mt-1.5 flex justify-between items-center w-full select-none">
          {/* 左侧：相对时间与内联展开控制 */}
          <div className="flex items-center gap-2.5">
            <span className="text-slate-500 font-medium text-[11px] pl-0.5">
              {ago(item.createdAt)}
            </span>
            {canExpand && (
              <button
                className="expand-toggle-inline text-slate-500 hover:text-[var(--ac)] text-[11px] flex items-center gap-0.5 transition-colors"
                onClick={(event) => {
                  event.stopPropagation()
                  setExpanded((value) => !value)
                }}
              >
                <span>
                  {expanded
                    ? '收起'
                    : item.type === 'file' && filePaths.length > 3
                      ? `还有 ${filePaths.length - 3} 个文件 · 展开`
                      : '展开'}
                </span>
                {expanded ? <ChevronUp size={10.5} /> : <ChevronDown size={10.5} />}
              </button>
            )}
          </div>

          {/* 右侧：自然渲染序号 */}
          <div className="flex items-center text-slate-500 text-[11px]">
            <span className="row__index font-mono text-[11.5px] text-slate-600 shrink-0">{index}</span>
          </div>
        </div>

        {/* 绝对定位的 Hover 动作按钮组 */}
        <div className="row__actions">
          <button
            className="act"
            title="复制"
            onClick={(event) => {
              event.stopPropagation()
              onCopy()
            }}
          >
            <Copy size={13} />
          </button>
          <button
            className={clsx('act', item.favorite && 'act-fav-on')}
            title={item.favorite ? '取消收藏' : '收藏'}
            onClick={(event) => {
              event.stopPropagation()
              onFavorite()
            }}
          >
            <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            className="act act-danger"
            title="删除"
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </li>
  )
}

/* ─────────────────────────  EMPTY  ───────────────────────── */

function EmptyState() {
  return (
    <div className="empty animate-[fadeIn_0.5s_ease]">
      <div className="empty-icon-glow">
        <ClipboardList size={32} className="animate-pulse" />
      </div>
      <h3 className="empty__hint">暂无归档记录</h3>
      <p className="empty__desc">开始在系统任意处复制一些文本、图片或文件，它们将实时呈现在这里。</p>
    </div>
  )
}

/* ─────────────────────────  DIALOGS  ───────────────────────── */

function Dialog({ data, onClose }: { data: any; onClose: () => void }) {
  const storeData = data?.store || {}
  const watcherData = data?.watcher || {}
  const apiStatus = data?.api || {}

  return (
    <div className="overlay" onClick={onClose}>
      <article className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-between items-center pb-2 border-b border-white/[0.04]">
          <div className="dialog__title">
            <Database size={15} />
            <span>存储与运行时数据仪表盘</span>
          </div>
          <button className="sb-btn shrink-0" onClick={onClose} title="关闭">
            <X size={13} />
          </button>
        </div>
        <div className="dialog__sub">
          当前剪贴板归档服务由核心引擎插件 <code className="text-[var(--ac)] bg-white/[0.04] px-1.5 py-0.5 rounded font-mono text-[11px]">com.brickly.clipboard-history</code> 常驻托管运行。
        </div>

        {/* 科幻数据网格卡片 */}
        <div className="dialog-grid">
          <div className="dialog-card">
            <div className="dialog-card__label">存储总条数</div>
            <div className="dialog-card__value text-cyan-400 font-semibold">{storeData?.count ?? 0} 条</div>
          </div>
          <div className="dialog-card">
            <div className="dialog-card__label">存储大小限制</div>
            <div className="dialog-card__value text-slate-300">{storeData?.maxItems ?? 500} 条历史记录</div>
          </div>
          <div className="dialog-card col-span-2">
            <div className="dialog-card__label">数据库文件路径</div>
            <div className="dialog-card__value select-text font-mono text-[11px] text-slate-300 truncate" title={storeData?.dbPath}>
              {storeData?.dbPath || '未初始化存储'}
            </div>
          </div>
          <div className="dialog-card col-span-2">
            <div className="dialog-card__label">媒体资源库目录</div>
            <div className="dialog-card__value select-text font-mono text-[11px] text-slate-300 truncate" title={storeData?.mediaDir}>
              {storeData?.mediaDir || '无独立媒体存储'}
            </div>
          </div>
          <div className="dialog-card">
            <div className="dialog-card__label">宿主监听状态</div>
            <div className="dialog-card__value flex items-center gap-1.5">
              <span className={clsx('w-2 h-2 rounded-full', watcherData?.enabled ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-500')} />
              <span className={watcherData?.enabled ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                {watcherData?.state === 'running' ? '实时运行中' : '未启用'}
              </span>
            </div>
          </div>
          <div className="dialog-card">
            <div className="dialog-card__label">宿主API通道</div>
            <div className="dialog-card__value flex items-center gap-1.5 text-slate-300">
              <Cpu size={12} className="text-violet-400" />
              <span>
                {apiStatus.store && apiStatus.platform ? '全双工通道正常' : '平台连接受限'}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 text-right">
          <button className="px-5 py-1.5 text-[12px] bg-[var(--ac)] text-slate-950 font-bold rounded-lg hover:bg-cyan-300 transition-colors shadow-lg hover:shadow-cyan-500/20" onClick={onClose}>
            确 认 并 关 闭
          </button>
        </div>
      </article>
    </div>
  )
}

function ImagePreviewDialog({ item, onClose }: { item: ClipItem; onClose: () => void }) {
  const imagePath = item.imagePath || item.imageOriginalPath || item.path
  if (!imagePath) return null

  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      
      // Proportional zoom factor
      // e.ctrlKey indicates macOS pinch-to-zoom on trackpad
      let factor = -e.deltaY * 0.0015
      if (e.ctrlKey) {
        // macOS pinch-to-zoom events have smaller delta values and need a larger multiplier for responsiveness
        factor = -e.deltaY * 0.015
      }
      
      setScale((s) => {
        const next = s + s * factor
        return Math.max(0.15, Math.min(next, 10)) // Allow zoom between 15% and 1000%
      })
    }

    overlay.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => {
      overlay.removeEventListener('wheel', handleWheelNative)
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    e.preventDefault()
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }

  const handleMouseUp = () => setIsDragging(false)

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (scale > 1.05 || position.x !== 0 || position.y !== 0) {
      setScale(1)
      setPosition({ x: 0, y: 0 })
    } else {
      setScale(2)
    }
  }

  const fileName = item.title || imagePath.split(/[\\/]/).pop() || '图片预览'

  return (
    <div ref={overlayRef} className="preview-overlay" onClick={onClose}>
      {/* Sleek, tiny minimalist close button */}
      <button className="preview-close-btn" onClick={onClose} title="关闭预览">
        <X size={15} />
      </button>

      {/* Pure Floating Image */}
      <img 
        className="preview-image"
        src={fileUrl(imagePath)} 
        alt="" 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onClick={(event) => event.stopPropagation()} // Clicking image won't close, clicking background does
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
          transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        draggable={false}
      />

      {/* Sleek Minimalist Floating HUD Badge */}
      <div className="preview-hud select-none">
        <span className="truncate max-w-[160px] font-medium" title={fileName}>{fileName}</span>
        {item.size && (
          <>
            <span className="hud-sep">•</span>
            <span>{formatSize(item.size)}</span>
          </>
        )}
        <span className="hud-sep">•</span>
        <span>{item.width && item.height ? `${item.width}×${item.height}` : '未知尺寸'}</span>
        <span className="hud-sep">•</span>
        <span className="text-[var(--ac)] font-mono font-bold">{Math.round(scale * 100)}%</span>
      </div>
    </div>
  )
}

/* ─────────────────────────  HELPERS  ───────────────────────── */

type StorageInfoLike = {
  dataDir?: string
  mediaDir?: string
  dbPath?: string
  count?: number
  brickId?: string
  maxItems?: number
  [key: string]: unknown
}

function clipboardContentForItem(item: ClipItem): ClipboardContent {
  if (item.type === 'image') {
    const path = item.imageOriginalPath || item.imagePath || item.path
    if (!path) throw new Error('图片文件路径缺失')
    return { kind: 'image', path }
  }
  if (item.type === 'file') {
    const paths = normalizedFilePaths(item)
    if (paths.length === 0) throw new Error('文件路径缺失')
    return { kind: 'file', paths }
  }
  return { kind: 'text', text: item.text ?? item.preview ?? '' }
}

function copySuccessText(item: ClipItem): string {
  if (item.type === 'image') return '已复制图片至剪贴板'
  if (item.type === 'file') {
    return `已复制 ${Math.max(normalizedFilePaths(item).length, 1)} 个文件至剪贴板`
  }
  return '已复制文本内容'
}

function normalizedFilePaths(item: ClipItem): string[] {
  const paths = item.paths?.filter((path) => typeof path === 'string' && path.trim()) ?? []
  if (paths.length > 0) return paths
  return item.path ? [item.path] : []
}

function isLikelyDirectory(path?: string): boolean {
  if (!path) return false
  const name = path.split(/[\\/]/).pop() || ''
  const KNOWN_FOLDERS = new Set(['.vscode', '.git', '.github', '.idea', '.svn', 'node_modules'])
  if (KNOWN_FOLDERS.has(name.toLowerCase())) {
    return true
  }
  if (name.startsWith('.')) {
    return false
  }
  return !name.includes('.')
}

function fileBaseName(path?: string): string {
  if (!path) return ''
  return path.split(/[\\/]/).pop() || path
}

function toStorageInfo(value: unknown): StorageInfoLike | null {
  if (!value || typeof value !== 'object') return null
  return value as StorageInfoLike
}

function fileUrl(p?: string): string {
  if (!p) return ''
  return 'file:///' + p.replaceAll('\\', '/')
}

function ago(ts: number): string {
  const sec = Math.round((ts - Date.now()) / 1000)
  const abs = Math.abs(sec)
  if (abs < 60) return rtf.format(sec, 'second')
  const min = Math.round(sec / 60)
  if (Math.abs(min) < 60) return rtf.format(min, 'minute')
  const hour = Math.round(min / 60)
  if (Math.abs(hour) < 24) return rtf.format(hour, 'hour')
  return rtf.format(Math.round(hour / 24), 'day')
}

function shortTime(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}`
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${m}-${d} ${hh}:${mm}`
}

function formatSize(bytes = 0): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function kindMetaLabel(type: ClipType): string {
  if (type === 'image') return '图像归档'
  if (type === 'file') return '文件归档'
  return '富文本/纯文本'
}

function truncatePath(p: string): string {
  if (p.length <= 80) return p
  return '…' + p.slice(p.length - 80)
}

function statusSummary(status?: WatcherStatus | null, suffix?: string): string {
  if (!status) return '系统归档服务离线'
  if (!status.enabled) return suffix ? `归档未启用 · ${suffix}` : '剪贴板同步已关闭，可在设置面板启用'
  if (status.state === 'running') return suffix ? `监控中 · ${suffix}` : `正在实时捕获剪贴板历史 (已发布 ${status.published ?? 0})`
  if (status.state === 'starting') return '剪贴板同步服务正在初始化...'
  if (status.state === 'error') return `监听异常 · ${status.lastError ?? '请在设置面板排查'}`
  return '服务未就绪'
}

function watcherDotClass(status?: WatcherStatus | null): string {
  if (!status?.enabled) return 'dot dot-off'
  if (status.state === 'error') return 'dot dot-warn'
  if (status.state === 'running') return 'dot'
  return 'dot dot-warn'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
