import clsx from 'clsx'
import {
  Archive,
  AudioLines,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Loader2,
  LocateFixed,
  Presentation,
  RefreshCw,
  Search,
  ShieldAlert,
  Table2
} from 'lucide-react'
import { renderAsync } from 'docx-preview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HealthStatus, PreviewResult, SearchCategory, SearchItem, SearchResult, SearchSort } from './types'

const categories: Array<{ id: SearchCategory; label: string; icon: typeof Search; color: string }> = [
  { id: 'all', label: '全部', icon: Search, color: '#6366f1' },
  { id: 'file', label: '文件', icon: File, color: '#94a3b8' },
  { id: 'folder', label: '文件夹', icon: Folder, color: '#eab308' },
  { id: 'excel', label: 'EXCEL', icon: FileSpreadsheet, color: '#10b981' },
  { id: 'word', label: 'WORD', icon: FileText, color: '#3b82f6' },
  { id: 'ppt', label: 'PPT', icon: Presentation, color: '#f97316' },
  { id: 'pdf', label: 'PDF', icon: FileText, color: '#ef4444' },
  { id: 'image', label: '图片', icon: FileImage, color: '#ec4899' },
  { id: 'video', label: '视频', icon: Film, color: '#8b5cf6' },
  { id: 'audio', label: '音频', icon: AudioLines, color: '#06b6d4' },
  { id: 'archive', label: '压缩文件', icon: Archive, color: '#a855f7' }
]

const sortOptions: Array<{ value: SearchSort; label: string }> = [
  { value: 'name_asc', label: '名称升序' },
  { value: 'name_desc', label: '名称降序' },
  { value: 'date_desc', label: '修改时间新到旧' },
  { value: 'date_asc', label: '修改时间旧到新' },
  { value: 'size_desc', label: '大小降序' },
  { value: 'size_asc', label: '大小升序' },
  { value: 'path_asc', label: '路径升序' },
  { value: 'path_desc', label: '路径降序' },
  { value: 'ext_asc', label: '扩展名升序' },
  { value: 'ext_desc', label: '扩展名降序' }
]

const emptyResult: SearchResult = {
  query: '',
  effectiveQuery: '*',
  category: 'all',
  categoryLabel: '全部',
  total: 0,
  offset: 0,
  limit: 50,
  items: []
}

export function App() {
  const api = window.localSearch
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<SearchCategory>('all')
  const [sort, setSort] = useState<SearchSort>('date_desc')
  const [page, setPage] = useState(0)
  const [limit] = useState(50)
  const [result, setResult] = useState<SearchResult>(emptyResult)
  const [selected, setSelected] = useState<SearchItem | null>(null)
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [notice, setNotice] = useState('准备就绪')
  const [selectedIcon, setSelectedIcon] = useState('')
  const requestRef = useRef(0)
  const previewRequestRef = useRef(0)

  const totalPages = Math.max(1, Math.ceil(result.total / limit))
  const canPrev = page > 0
  const canNext = (page + 1) * limit < result.total

  const selectedPath = selected?.fullPath || joinPath(selected)

  const categoryStats = useMemo(() => {
    const stats = new Map<SearchCategory, number>()
    stats.set(result.category, result.total)
    return stats
  }, [result.category, result.total])

  const selectedIndex = useMemo(() => {
    if (!selected || !result.items.length) return -1
    return result.items.findIndex(
      (item) => (item.fullPath || joinPath(item)) === selectedPath
    )
  }, [selected, result.items, selectedPath])

  const runHealth = useCallback(async () => {
    if (!api) {
      setNotice('本地搜索接口未注入')
      return
    }
    try {
      const next = await api.health()
      setHealth(next)
      if (!next.ok) {
        setNotice(next.everythingError || next.error || 'Everything 未就绪')
      } else {
        setNotice('Everything 索引已连接')
      }
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }, [api])

  const runSearch = useCallback(
    async (nextPage: number) => {
      if (!api) {
        setNotice('本地搜索接口未注入')
        return
      }
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      setLoading(true)
      try {
        const next = await api.search({
          query,
          category,
          offset: nextPage * limit,
          limit,
          sort
        })
        if (requestRef.current !== requestId) return
        setResult(next)
        setSelected(next.items[0] || null)
        setNotice(next.items.length ? `找到 ${next.total.toLocaleString()} 条结果` : '没有匹配结果')
      } catch (error) {
        if (requestRef.current !== requestId) return
        setResult((current) => ({ ...current, items: [], total: 0, offset: nextPage * limit }))
        setSelected(null)
        setNotice(errorMessage(error))
      } finally {
        if (requestRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [api, category, limit, query, sort]
  )

  useEffect(() => {
    void runHealth()
  }, [runHealth])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(0)
      void runSearch(0)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [category, query, sort, runSearch])

  useEffect(() => {
    if (!api?.getFileIcon || !selectedPath) {
      setSelectedIcon('')
      return
    }
    let live = true
    api.getFileIcon(selectedPath)
      .then((value) => {
        if (live) setSelectedIcon(value || '')
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [api, selectedPath])

  // 快捷操作核心函数封装
  const openSelected = useCallback(async (path?: string) => {
    const targetPath = path || selectedPath
    if (!api || !targetPath) return
    try {
      await api.openPath(targetPath)
      setNotice('已打开文件')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }, [api, selectedPath])

  const showSelected = useCallback(async (path?: string) => {
    const targetPath = path || selectedPath
    if (!api || !targetPath) return
    try {
      await api.showInFolder(targetPath)
      setNotice('已在资源管理器中定位')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }, [api, selectedPath])

  const copySelectedPath = useCallback(async (path?: string) => {
    const targetPath = path || selectedPath
    if (!api || !targetPath) return
    try {
      await api.copyText(targetPath)
      setNotice('已复制路径')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }, [api, selectedPath])

  useEffect(() => {
    if (!api || !selectedPath || !selected?.isFile) {
      setPreview(null)
      setPreviewError('')
      setPreviewLoading(false)
      return
    }
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    setPreviewLoading(true)
    setPreviewError('')
    void api
      .preview({ path: selectedPath, maxBytes: 20 * 1024, maxEntries: 80 })
      .then((next) => {
        if (previewRequestRef.current !== requestId) return
        setPreview(next)
      })
      .catch((error) => {
        if (previewRequestRef.current !== requestId) return
        setPreview(null)
        setPreviewError(errorMessage(error))
      })
      .finally(() => {
        if (previewRequestRef.current === requestId) {
          setPreviewLoading(false)
        }
      })
  }, [api, selected, selectedPath])

  // 键盘快捷键导航与滚动
  const scrollToIndex = useCallback((index: number) => {
    const container = document.querySelector('.result-list')
    if (!container) return
    const rows = container.querySelectorAll('.result-row')
    const activeRow = rows[index] as HTMLElement | undefined
    if (activeRow) {
      activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      const isPreviewSurface =
        e.target instanceof HTMLElement && Boolean(e.target.closest('.preview-content'))
      const len = result.items.length

      if (isPreviewSurface) {
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (len === 0) return
        const nextIndex = (selectedIndex + 1) % len
        setSelected(result.items[nextIndex])
        scrollToIndex(nextIndex)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (len === 0) return
        const prevIndex = (selectedIndex - 1 + len) % len
        setSelected(result.items[prevIndex])
        scrollToIndex(prevIndex)
      } else if (e.key === 'Enter') {
        // 如果有选中的文件，回车键直接打开
        if (selected) {
          e.preventDefault()
          void openSelected()
        }
      } else if (e.key === 'Escape') {
        if (isInput) {
          e.preventDefault()
          setQuery('')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [result.items, selectedIndex, selected, openSelected, scrollToIndex])

  const hasPreview = useMemo(() => {
    return Boolean(
      selected &&
        !selected.isFolder &&
        preview &&
        preview.supported &&
        preview.kind !== 'unsupported' &&
        !previewLoading &&
        !previewError
    )
  }, [selected, preview, previewLoading, previewError])

  function goPage(nextPage: number) {
    const normalized = Math.max(0, Math.min(nextPage, totalPages - 1))
    setPage(normalized)
    void runSearch(normalized)
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Search size={18} />
          </div>
          <div>
            <strong>本地搜索</strong>
            <span>Everything · Go native</span>
          </div>
        </div>
        <nav className="category-list">
          {categories.map((item) => {
            const Icon = item.icon
            const active = category === item.id
            return (
              <button
                key={item.id}
                className={clsx('category-item', active && 'category-item-active')}
                onClick={() => setCategory(item.id)}
                type="button"
              >
                <Icon size={15} style={{ color: active ? undefined : item.color }} />
                <span>{item.label}</span>
                {categoryStats.get(item.id) ? (
                  <em>{categoryStats.get(item.id)?.toLocaleString()}</em>
                ) : null}
              </button>
            )
          })}
        </nav>
        <HealthPanel health={health} onRefresh={runHealth} />
      </aside>

      <section className="content">
        <header className="toolbar">
          <div className="searchbox">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入文件名、路径或 Everything 查询语法 (Esc 清空)"
              spellCheck={false}
              autoFocus
            />
          </div>
          <select value={sort} onChange={(event) => setSort(event.target.value as SearchSort)}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="icon-btn" onClick={() => void runSearch(page)} title="刷新结果" type="button">
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          </button>
        </header>

        <section className="workspace">
          <section className="results-pane">
            <div className="result-head">
              <span>{result.categoryLabel || '全部'}</span>
              <strong>{result.total.toLocaleString()} 条</strong>
            </div>
            {result.items.length === 0 ? (
              <div className="empty">
                <Search size={34} />
                <h2>{loading ? '搜索中' : '暂无结果'}</h2>
                <p>{loading ? '正在读取 Everything 索引' : '换个关键词或分类再试一次'}</p>
              </div>
            ) : (
              <ul className="result-list">
                {result.items.map((item) => {
                  const itemPath = item.fullPath || joinPath(item)
                  const active = selectedPath === itemPath
                  return (
                    <ResultRow
                      key={`${itemPath}:${item.dateModified}`}
                      item={item}
                      active={active}
                      query={query}
                      onSelect={() => setSelected(item)}
                      onOpen={() => void openSelected(itemPath)}
                      onShowInFolder={() => void showSelected(itemPath)}
                      onCopyPath={() => void copySelectedPath(itemPath)}
                      getIcon={api?.getFileIcon}
                    />
                  )
                })}
              </ul>
            )}
            <footer className="pager">
              <button type="button" disabled={!canPrev || loading} onClick={() => goPage(page - 1)}>
                上一页
              </button>
              <span>
                第 {page + 1} / {totalPages} 页
              </span>
              <button type="button" disabled={!canNext || loading} onClick={() => goPage(page + 1)}>
                下一页
              </button>
            </footer>
          </section>

          <aside className="detail-pane" style={hasPreview ? { padding: 0 } : undefined}>
            {selected ? (
              hasPreview ? (
                <div className="preview-content-only">
                  {renderPreviewBody(preview!, () => void openSelected(), () => void showSelected())}
                </div>
              ) : previewLoading ? (
                <div className="preview-state">
                  <Loader2 size={28} className="spin" />
                  <h2>正在生成预览</h2>
                  <p>只读取受限大小的内容，不会加载完整大文件。</p>
                </div>
              ) : (
                <div className="unsupported-container">
                  <div className="unsupported-icon">
                    {selectedIcon ? (
                      <img src={selectedIcon} alt="" />
                    ) : (
                      <FileBadge item={selected} size={42} />
                    )}
                  </div>
                  <div className="unsupported-title" title={selected.name}>
                    {selected.name}
                  </div>
                  <div className="unsupported-meta-grid">
                    <span className="unsupported-meta-label">大小</span>
                    <span className="unsupported-meta-value">
                      {selected.isFolder ? '文件夹' : formatBytes(selected.size)}
                    </span>
                    
                    <span className="unsupported-meta-label">修改时间</span>
                    <span className="unsupported-meta-value">
                      {formatTime(selected.dateModified)}
                    </span>
                    
                    <span className="unsupported-meta-label">所在路径</span>
                    <span className="unsupported-meta-value">
                      {selected.path}
                    </span>
                  </div>
                  
                  <div className="unsupported-actions" style={{ marginTop: '32px', width: '100%', maxWidth: '290px' }}>
                    <div className="detail-actions">
                      <button onClick={() => void openSelected()} type="button">
                        <ExternalLink size={16} />
                        打开文件
                      </button>
                      <button onClick={() => void showSelected()} type="button">
                        <LocateFixed size={16} />
                        定位目录
                      </button>
                      <button onClick={() => void copySelectedPath()} type="button">
                        <Clipboard size={16} />
                        复制路径
                      </button>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="detail-empty">
                <FolderOpen size={38} />
                <h2>选择一个结果</h2>
                <p>文件详情和操作会显示在这里。</p>
              </div>
            )}
          </aside>
        </section>

        <footer className="statusbar">
          <span className={clsx('status-dot', health?.ok ? 'status-ok' : 'status-warn')} />
          <span>{notice}</span>
          <code>{result.effectiveQuery}</code>
        </footer>
      </section>
    </main>
  )
}

function HealthPanel({ health, onRefresh }: { health: HealthStatus | null; onRefresh: () => void }) {
  const ok = Boolean(health?.ok)
  return (
    <section className="health">
      <div className="health-title">
        {ok ? (
          <CheckCircle2 size={15} className="health-ok" />
        ) : (
          <ShieldAlert size={15} className="health-warn" />
        )}
        <span>{ok ? '索引可用' : '索引未就绪'}</span>
        <button type="button" onClick={onRefresh} title="检查状态">
          <RefreshCw size={12} />
        </button>
      </div>
      <p>{health?.everythingError || health?.error || (ok ? 'Everything IPC 正常' : '等待状态检查')}</p>
    </section>
  )
}


function renderPreviewBody(preview: PreviewResult, onOpen: () => void, onShowInFolder: () => void) {
  switch (preview.kind) {
    case 'text':
      return (
        <TextPreviewBlock
          content={preview.text?.content || ''}
          encoding={preview.text?.encoding}
          lineCount={preview.text?.lineCount}
          truncated={preview.truncated}
        />
      )
    case 'document':
      return (
        <DocumentPreviewBlock preview={preview} />
      )
    case 'spreadsheet':
      return <SpreadsheetPreviewBlock preview={preview} />
    case 'archive':
      return <ArchivePreviewBlock preview={preview} />
    case 'image':
      return (
        <div className="preview-media preview-image">
          {preview.fileUrl ? <img src={preview.fileUrl} alt={preview.name} /> : null}
          {preview.image?.width && preview.image?.height ? (
            <p>
              {preview.image.width} × {preview.image.height}
            </p>
          ) : null}
        </div>
      )
    case 'audio':
      return (
        <div className="preview-media">
          <audio controls preload="metadata" src={preview.fileUrl} />
        </div>
      )
    case 'video':
      return (
        <div className="preview-media">
          <video controls preload="metadata" src={preview.fileUrl} />
        </div>
      )
    case 'pdf':
      return (
        <div className="preview-pdf">
          <iframe src={pdfPreviewUrl(preview.fileUrl)} title={preview.name} />
          <p>如果 PDF 没有显示，请使用打开文件查看。</p>
        </div>
      )
    default:
      return (
        <PreviewState
          icon={<File size={28} />}
          title="暂不支持内嵌预览"
          description={preview.reason || preview.message || '可以使用打开文件或定位目录继续查看。'}
          onOpen={onOpen}
          onShowInFolder={onShowInFolder}
        />
      )
  }
}

function TextPreviewBlock({
  content,
  encoding,
  lineCount,
  truncated,
  emptyText = '文件中没有可显示文本。'
}: {
  content: string
  encoding?: string
  lineCount?: number
  truncated?: boolean
  emptyText?: string
}) {
  const lines = useMemo(() => (content ? content.split(/\r?\n/) : []), [content])
  return (
    <div className="preview-text-wrap">
      <div className="preview-text-meta">
        <span>{encoding || 'utf-8'}</span>
        <span>{lineCount || lines.length || 0} 行</span>
        {truncated ? <strong>已截断</strong> : null}
      </div>
      {content ? (
        <div className="preview-text">
          {lines.map((line, i) => (
            <div className="preview-text-line" key={i}>
              <span className="line-num">{i + 1}</span>
              <span className="line-code">{line || ' '}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="preview-empty-line">{emptyText}</p>
      )}
    </div>
  )
}

function DocumentPreviewBlock({ preview }: { preview: PreviewResult }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [renderState, setRenderState] = useState<'idle' | 'rendering' | 'ready' | 'fallback'>('idle')
  const [renderError, setRenderError] = useState('')
  const documentPackage = preview.document?.package

  useEffect(() => {
    const container = containerRef.current
    if (!container || !documentPackage) {
      setRenderState('fallback')
      return
    }
    let live = true
    container.innerHTML = ''
    setRenderState('rendering')
    setRenderError('')
    const data = base64ToUint8Array(documentPackage)
    void renderAsync(data, container, undefined, {
      className: 'docx-preview-document',
      inWrapper: false,
      ignoreFonts: false,
      ignoreHeight: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true
    })
      .then(() => {
        if (live) setRenderState('ready')
      })
      .catch((error) => {
        if (!live) return
        container.innerHTML = ''
        setRenderState('fallback')
        setRenderError(errorMessage(error))
      })
    return () => {
      live = false
      container.innerHTML = ''
    }
  }, [documentPackage])

  if (!documentPackage || renderState === 'fallback') {
    return (
      <div className="preview-document-fallback">
        {renderError ? <div className="preview-docx-error">DOCX 渲染失败，已切换为正文预览：{renderError}</div> : null}
        <TextPreviewBlock
          content={preview.document?.content || ''}
          encoding={preview.document?.encoding}
          lineCount={preview.document?.lineCount}
          truncated={preview.truncated}
          emptyText="文档中没有提取到可显示正文。"
        />
      </div>
    )
  }

  return (
    <div className="preview-docx-wrap">
      {renderState === 'rendering' ? (
        <div className="preview-docx-loading">
          <Loader2 size={18} className="spin" />
          <span>正在渲染 Word 文档</span>
        </div>
      ) : null}
      <div className="preview-docx-pages" ref={containerRef} />
    </div>
  )
}

function ArchivePreviewBlock({ preview }: { preview: PreviewResult }) {
  const entries = preview.archive?.entries || []
  return (
    <div className="preview-list">
      <div className="preview-list-head">
        <span>{preview.archive?.total || 0} 个条目</span>
        {preview.archive?.truncated ? <strong>仅显示前 {entries.length} 项</strong> : null}
      </div>
      {entries.map((entry) => (
        <div className="preview-list-row" key={`${entry.name}:${entry.size}`}>
          <div>
            {entry.isDirectory ? <Folder size={14} /> : <File size={14} />}
            <span title={entry.name}>{entry.name}</span>
          </div>
          <em>{entry.isDirectory ? '目录' : formatBytes(entry.size)}</em>
        </div>
      ))}
    </div>
  )
}

function SpreadsheetPreviewBlock({ preview }: { preview: PreviewResult }) {
  const sheets = preview.spreadsheet?.sheets || []
  if (!sheets.length) {
    return (
      <PreviewState
        icon={<Table2 size={28} />}
        title="没有可显示的工作表"
        description={preview.reason || '表格结构可能为空，或当前版本无法解析。'}
      />
    )
  }

  const getColLabel = (index: number) => {
    let label = ''
    let temp = index
    while (temp >= 0) {
      label = String.fromCharCode((temp % 26) + 65) + label
      temp = Math.floor(temp / 26) - 1
    }
    return label
  }

  return (
    <div className="preview-sheets">
      {sheets.map((sheet) => {
        const width = Math.max(...sheet.rows.map((row) => row.length), 1)
        return (
          <section className="preview-sheet" key={sheet.name}>
            <div className="preview-sheet-title">
              <Table2 size={14} />
              <span>{sheet.name}</span>
              {sheet.truncated ? <strong>已截断</strong> : null}
            </div>
            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    {Array.from({ length: width }).map((_, cellIndex) => (
                      <th key={cellIndex}>{getColLabel(cellIndex)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <th>{rowIndex + 1}</th>
                      {Array.from({ length: width }).map((_, cellIndex) => (
                        <td key={cellIndex}>{row[cellIndex] || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function PreviewState({
  icon,
  title,
  description,
  onOpen,
  onShowInFolder
}: {
  icon: React.ReactNode
  title: string
  description: string
  onOpen?: () => void
  onShowInFolder?: () => void
}) {
  return (
    <div className="preview-state">
      {icon}
      <h2>{title}</h2>
      <p>{description}</p>
      {onOpen || onShowInFolder ? (
        <div className="preview-state-actions">
          {onOpen ? (
            <button onClick={onOpen} type="button">
              <ExternalLink size={14} />
              打开
            </button>
          ) : null}
          {onShowInFolder ? (
            <button onClick={onShowInFolder} type="button">
              <LocateFixed size={14} />
              定位
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function previewLabel(preview: PreviewResult) {
  const labels: Record<string, string> = {
    text: '文本预览',
    document: 'Word 正文',
    spreadsheet: 'Excel 表格',
    archive: '压缩包目录',
    image: '图片预览',
    audio: '音频预览',
    video: '视频预览',
    pdf: 'PDF 预览',
    directory: '文件夹',
    unsupported: '不可预览'
  }
  return labels[preview.kind] || '文件预览'
}

function pdfPreviewUrl(fileUrl?: string) {
  if (!fileUrl) return undefined
  const separator = fileUrl.includes('#') ? '&' : '#'
  return `${fileUrl}${separator}pagemode=none&navpanes=0`
}

function base64ToUint8Array(value: string) {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

// 搜索词高亮展示组件
function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  const trimmed = highlight.trim()
  if (!trimmed) return <span>{text}</span>
  try {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return (
      <span>
        {parts.map((part, index) =>
          part.toLowerCase() === trimmed.toLowerCase() ? (
            <span key={index} className="search-highlight">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </span>
    )
  } catch {
    return <span>{text}</span>
  }
}

function ResultRow({
  item,
  active,
  query,
  onSelect,
  onOpen,
  onShowInFolder,
  onCopyPath,
  getIcon
}: {
  item: SearchItem
  active: boolean
  query: string
  onSelect: () => void
  onOpen: () => void
  onShowInFolder: () => void
  onCopyPath: () => void
  getIcon?: (path: string) => Promise<string>
}) {
  const [icon, setIcon] = useState('')
  const fullPath = item.fullPath || joinPath(item)

  useEffect(() => {
    if (!getIcon || !fullPath) return
    let live = true
    getIcon(fullPath)
      .then((value) => {
        if (live) setIcon(value || '')
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [fullPath, getIcon])

  return (
    <li className={clsx('result-row', active && 'result-row-active')} onClick={onSelect}>
      <div className="row-icon">
        {icon ? <img src={icon} alt="" /> : <FileBadge item={item} />}
      </div>
      <div className="row-main">
        <div className="row-title" title={item.name}>
          <HighlightText text={item.name} highlight={query} />
        </div>
        <div className="row-path" title={fullPath}>
          {fullPath}
        </div>
      </div>
      <div className="row-meta">
        <span>{item.isFolder ? '文件夹' : formatBytes(item.size)}</span>
        <time>{formatTime(item.dateModified, true)}</time>
      </div>
      {/* 鼠标悬停时的快捷操作按钮 */}
      <div className="row-actions-overlay">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          title="直接打开"
        >
          <ExternalLink size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onShowInFolder()
          }}
          title="在文件夹中定位"
        >
          <LocateFixed size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCopyPath()
          }}
          title="复制文件路径"
        >
          <Clipboard size={14} />
        </button>
      </div>
    </li>
  )
}

function FileBadge({ item, size = 18 }: { item: SearchItem; size?: number }) {
  if (item.isFolder) {
    return <Folder size={size} style={{ color: '#eab308' }} />
  }
  const ext = item.extension.toLowerCase()
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return <FileSpreadsheet size={size} style={{ color: '#10b981' }} />
  }
  if (['doc', 'docx'].includes(ext)) {
    return <FileText size={size} style={{ color: '#3b82f6' }} />
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return <Presentation size={size} style={{ color: '#f97316' }} />
  }
  if (ext === 'pdf') {
    return <FileText size={size} style={{ color: '#ef4444' }} />
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return <FileImage size={size} style={{ color: '#ec4899' }} />
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
    return <Film size={size} style={{ color: '#8b5cf6' }} />
  }
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) {
    return <AudioLines size={size} style={{ color: '#06b6d4' }} />
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <Archive size={size} style={{ color: '#a855f7' }} />
  }
  return <File size={size} style={{ color: '#94a3b8' }} />
}

function joinPath(item: SearchItem | null) {
  if (!item) return ''
  if (item.fullPath) return item.fullPath
  if (!item.path) return item.name
  return `${item.path.replace(/[\\/]+$/, '')}\\${item.name}`
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatTime(value: number, short = false) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return short
    ? date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : date.toLocaleString('zh-CN')
}

function errorMessage(error: unknown) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message)
  return String(error)
}
