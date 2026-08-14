import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createHistoryRefreshScheduler,
  clearHistory,
  getRuntimeStatus,
  getStorageInfo,
  listHistory,
  removeHistoryItem,
  setClipboardContent,
  readHistoryText,
  subscribeHistoryChanged,
  startRuntimeService,
  syncClipboardNow,
  toggleHistoryFavorite
} from './brickly'
import type { ClipItem, ClipboardContent, RuntimeStatus, StorageInfo } from './types'
import { TitleBar } from './components/TitleBar'
import { TopBar, type FilterId } from './components/TopBar'
import { ClipRow } from './components/ClipRow'
import { EmptyState } from './components/EmptyState'
import { StatusBar } from './components/StatusBar'
import { StorageDialog } from './components/StorageDialog'
import { ImagePreviewDialog } from './components/ImagePreviewDialog'
import { Toast } from './components/Toast'

/**
 * Premium Glassmorphism Clipboard History Brick UI
 * 剪贴板历史主应用：整合自绘标题栏、流式列表、存储看板与交互弹窗。
 */
export function App() {
  const [items, setItems] = useState<ClipItem[]>([])
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('初始化')
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [storageInfoData, setStorageInfoData] = useState<StorageInfo | null>(null)
  const [eventsConnected, setEventsConnected] = useState(false)
  const [toast, setToast] = useState('')
  const [colophonOpen, setColophonOpen] = useState(false)
  const [imagePreview, setImagePreview] = useState<ClipItem | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const notify = (text: string): void => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1600)
  }

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const refresh = async (): Promise<void> => {
    const next = await listHistory()
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
    let alive = true
    let unsubscribe: (() => void | Promise<void>) | undefined

    const scheduler = createHistoryRefreshScheduler(async () => {
      if (!alive) return
      await Promise.all([refresh(), refreshStorageSnapshot(), refreshRuntimeSnapshot()])
    })

    const onFocusRefresh = (): void => {
      if (!alive || document.visibilityState === 'hidden') return
      void Promise.all([refresh(), refreshStorageSnapshot(), refreshRuntimeSnapshot()])
    }
    window.addEventListener('focus', onFocusRefresh)
    document.addEventListener('visibilitychange', onFocusRefresh)

    ;(async () => {
      let subscriptionError = ''
      let serviceStartError = ''
      try {
        await startRuntimeService()
      } catch (error) {
        serviceStartError = errorMessage(error)
        console.warn('[clipboard-history/ui] init service.start error', { error: serviceStartError })
      }
      try {
        unsubscribe = await subscribeHistoryChanged((envelope) => {
          if (!alive) return
          scheduler.schedule(envelope)
          setStatusText(`历史已更新 · ${envelope.payload.count}`)
          if (envelope.payload.reason === 'insert') notify('已归档到剪贴板')
        })
        if (!alive) {
          await unsubscribe()
          return
        }
        setEventsConnected(true)
      } catch (error) {
        subscriptionError = errorMessage(error)
        if (alive) setEventsConnected(false)
        console.warn('[clipboard-history/ui] subscribe failed', { error: subscriptionError })
      }
      try {
        const [, , status] = await Promise.all([
          refresh(),
          refreshStorageSnapshot(),
          refreshRuntimeSnapshot()
        ])
        setStatusText(
          serviceStartError
            ? `服务启动失败 · ${serviceStartError}`
            : subscriptionError
              ? `事件通知不可用 · ${subscriptionError}`
              : runtimeStatusSummary(status)
        )
      } catch (error) {
        setStatusText(`初始化失败 · ${errorMessage(error)}`)
        notify(errorMessage(error))
        console.warn('[clipboard-history/ui] init failed', { error: errorMessage(error) })
      }
    })()

    return () => {
      alive = false
      scheduler.cancel()
      void unsubscribe?.()
      window.removeEventListener('focus', onFocusRefresh)
      document.removeEventListener('visibilitychange', onFocusRefresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshStorageSnapshot(): Promise<StorageInfo> {
    const info = await getStorageInfo()
    setStorageInfoData(info)
    return info
  }

  async function refreshRuntimeSnapshot(): Promise<RuntimeStatus> {
    const status = await getRuntimeStatus()
    setRuntimeStatus(status)
    return status
  }

  async function handleSyncNow(silent = false): Promise<void> {
    try {
      if (!silent) setStatusText('同步剪贴板中...')
      const result = await syncClipboardNow()
      const [, , status] = await Promise.all([
        refresh(),
        refreshStorageSnapshot(),
        refreshRuntimeSnapshot()
      ])
      const outcome = result.changed ? '已归档当前内容' : '无新内容'
      setStatusText(runtimeStatusSummary(status, outcome))
      if (!silent) notify(result.changed ? '已同步系统剪贴板' : '剪贴板内容未变化')
    } catch (error) {
      setStatusText(`同步失败 · ${errorMessage(error)}`)
      notify(errorMessage(error))
    }
  }

  async function handleCopyItem(item: ClipItem): Promise<void> {
    try {
      await setClipboardContent(await clipboardContentForItem(item))
      notify(copySuccessText(item))
    } catch (error) {
      notify(`写入剪贴板失败 · ${errorMessage(error)}`)
    }
  }

  async function handleToggleFavorite(item: ClipItem): Promise<void> {
    await toggleHistoryFavorite(item.id, !item.favorite)
    await refresh()
  }

  async function handleRemoveItem(item: ClipItem): Promise<void> {
    await removeHistoryItem(item.id)
    await refresh()
    notify('已彻底移除历史记录')
  }

  async function handleClearHistory(): Promise<void> {
    if (items.length === 0) return
    const confirmed = window.confirm('确认清空所有非收藏的历史记录？')
    if (!confirmed) return
    try {
      await clearHistory(true)
      await refresh()
      notify('已清空非收藏历史记录')
    } catch (error) {
      notify(`清空历史失败 · ${errorMessage(error)}`)
    }
  }

  const stats = {
    all: items.length,
    text: items.filter((it) => it.type === 'text').length,
    image: items.filter((it) => it.type === 'image').length,
    file: items.filter((it) => it.type === 'file').length,
    favorite: items.filter((it) => it.favorite).length
  }

  return (
    <main className="app-bg grid h-screen grid-rows-[auto_auto_1fr_auto] overflow-hidden select-none">
      {/* ────── TOP 1: Custom TitleBar ────── */}
      <TitleBar />

      {/* ────── TOP 2: Search + Filter Chips Bar ────── */}
      <TopBar
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        stats={stats}
        onClearHistory={handleClearHistory}
      />

      {/* ────── BODY: Rows Stream ────── */}
      <div className="min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list-container">
            {filtered.map((item, idx) => (
              <ClipRow
                key={item.id}
                item={item}
                index={idx + 1}
                active={selectedId === item.id}
                onSelect={() => setSelectedId(item.id)}
                onCopy={() => handleCopyItem(item)}
                onFavorite={() => handleToggleFavorite(item)}
                onRemove={() => handleRemoveItem(item)}
                onPreviewImage={() => setImagePreview(item)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ────── BOTTOM: Status Bar ────── */}
      <StatusBar
        itemsCount={items.length}
        favoriteCount={stats.favorite}
        statusText={statusText}
        runtimeStatus={runtimeStatus}
        storageInfoData={storageInfoData}
        onSyncNow={() => handleSyncNow(false)}
        onOpenDialog={async () => {
          await refreshStorageSnapshot()
          setColophonOpen(true)
        }}
      />

      {/* ────── DIALOGS ────── */}
      {colophonOpen && (
        <StorageDialog
          data={{
            store: storageInfoData,
            runtime: runtimeStatus,
            api: { commands: Boolean(runtimeStatus), events: eventsConnected }
          }}
          onClose={() => setColophonOpen(false)}
        />
      )}
      {imagePreview && (
        <ImagePreviewDialog item={imagePreview} onClose={() => setImagePreview(null)} />
      )}

      {/* ────── TOAST ────── */}
      <Toast message={toast} />
    </main>
  )
}

/* ───────────────────────── 辅助工具函数 ───────────────────────── */

async function clipboardContentForItem(item: ClipItem): Promise<ClipboardContent> {
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
  return { kind: 'text', text: await readHistoryText(item.id) }
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

function runtimeStatusSummary(status?: RuntimeStatus | null, suffix?: string): string {
  if (!status) return '剪贴板历史 Runtime 离线'
  if (status.state === 'running') {
    return suffix
      ? `Runtime 运行中 · ${suffix}`
      : `正在实时归档剪贴板历史 (已处理 ${status.processedEvents} 次事件)`
  }
  if (status.state === 'error') return `Runtime 异常 · ${status.lastError ?? '请查看运行日志'}`
  return '服务未就绪'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
