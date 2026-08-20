import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  checkHealth,
  copyText,
  getFileIcon,
  hasBrickly,
  openExternal,
  openPath,
  previewFile,
  searchFiles,
  showInFolder
} from './bridge'
import { CategoryNav } from './components/CategoryNav'
import { DetailPane } from './components/DetailPane'
import { HealthPanel } from './components/HealthPanel'
import { ResultsPane } from './components/ResultsPane'
import { SearchToolbar } from './components/SearchToolbar'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { WorkspaceSplit } from './components/WorkspaceSplit'
import { emptyResult } from './constants'
import {
  EVERYTHING_DOWNLOAD_URL,
  blockedHealth,
  healthReason,
  healthStatusLabel,
  indexErrorReason,
  isIndexReady
} from './health'
import { errorMessage, joinPath } from './lib/format'
import type { HealthStatus, PreviewResult, SearchCategory, SearchItem, SearchResult, SearchSort } from './types'

export function App() {
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
  const [starting, setStarting] = useState(false)
  const requestRef = useRef(0)
  const previewRequestRef = useRef(0)
  const indexReadyRef = useRef(false)
  const reason = healthReason(health)
  const indexReady = isIndexReady(health)
  indexReadyRef.current = indexReady

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
    return result.items.findIndex((item) => (item.fullPath || joinPath(item)) === selectedPath)
  }, [selected, result.items, selectedPath])

  const runHealth = useCallback(async () => {
    if (!hasBrickly()) {
      setNotice('本地搜索接口未注入')
      return
    }
    try {
      const next = await checkHealth()
      setHealth(next)
      if (isIndexReady(next)) {
        setNotice('Everything 索引已连接')
      } else {
        setNotice(next.everythingError || next.error || 'Everything 未就绪')
      }
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }, [])

  const runSearch = useCallback(
    async (nextPage: number) => {
      if (!hasBrickly()) {
        setNotice('本地搜索接口未注入')
        return
      }
      if (!indexReadyRef.current) {
        return
      }
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      setLoading(true)
      try {
        const next = await searchFiles({
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
        const blocked = indexErrorReason(error)
        if (blocked) {
          setHealth((current) => blockedHealth(current, blocked, errorMessage(error)))
          setResult(emptyResult)
          setSelected(null)
          setNotice(errorMessage(error))
          return
        }
        setResult((current) => ({ ...current, items: [], total: 0, offset: nextPage * limit }))
        setSelected(null)
        setNotice(errorMessage(error))
      } finally {
        if (requestRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [category, limit, query, sort]
  )

  useEffect(() => {
    void runHealth()
  }, [runHealth])

  useEffect(() => {
    if (!indexReady) {
      setResult(emptyResult)
      setSelected(null)
      return
    }
    const timer = window.setTimeout(() => {
      setPage(0)
      void runSearch(0)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [indexReady, category, query, sort, runSearch])

  useEffect(() => {
    if (indexReady) return
    if (reason === 'missing_sdk' || reason === 'unsupported' || reason === 'not_installed') return
    let cancelled = false
    const tick = async () => {
      if (cancelled || !hasBrickly()) return
      try {
        const next = await checkHealth()
        if (cancelled) return
        setHealth(next)
        if (next.ok && next.ipcReady) setNotice('Everything 索引已连接')
        else setNotice(next.everythingError || next.error || '正在建立索引…')
      } catch (error) {
        if (!cancelled) setNotice(errorMessage(error))
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [indexReady, reason])

  const waitForIndex = useCallback(async () => {
    let latest: HealthStatus | null = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
      if (!hasBrickly()) return null
      try {
        latest = await checkHealth()
        setHealth(latest)
        if (latest.ok && latest.ipcReady) {
          setNotice('Everything 索引已连接')
          return latest
        }
        if (healthReason(latest) === 'indexing') {
          setNotice(latest.everythingError || '正在建立索引…')
          return latest
        }
        setNotice(latest.everythingError || latest.error || 'Everything 未就绪')
      } catch (error) {
        setNotice(errorMessage(error))
      }
    }
    return latest
  }, [])

  const openDownload = useCallback(async () => {
    try {
      await openExternal(health?.downloadUrl || EVERYTHING_DOWNLOAD_URL)
      setNotice('已打开 Everything 下载页')
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }, [health?.downloadUrl])

  const startEverything = useCallback(async () => {
    setStarting(true)
    try {
      await runHealth()
      setNotice('正在后台启动 Everything…')
      const next = await waitForIndex()
      if (next?.ok) return
      if (healthReason(next) === 'indexing' || healthReason(next) === 'not_running') return
      setNotice('Everything 正在启动，请稍候')
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setStarting(false)
    }
  }, [runHealth, waitForIndex])

  useEffect(() => {
    if (!hasBrickly() || !selectedPath) {
      setSelectedIcon('')
      return
    }
    let live = true
    getFileIcon(selectedPath)
      .then((value) => {
        if (live) setSelectedIcon(value || '')
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [selectedPath])

  const openSelected = useCallback(
    async (path?: string) => {
      const targetPath = path || selectedPath
      if (!hasBrickly() || !targetPath) return
      try {
        await openPath(targetPath)
        setNotice('已打开文件')
      } catch (error) {
        setNotice(errorMessage(error))
      }
    },
    [selectedPath]
  )

  const showSelected = useCallback(
    async (path?: string) => {
      const targetPath = path || selectedPath
      if (!hasBrickly() || !targetPath) return
      try {
        await showInFolder(targetPath)
        setNotice('已在资源管理器中定位')
      } catch (error) {
        setNotice(errorMessage(error))
      }
    },
    [selectedPath]
  )

  const copySelectedPath = useCallback(
    async (path?: string) => {
      const targetPath = path || selectedPath
      if (!hasBrickly() || !targetPath) return
      try {
        await copyText(targetPath)
        setNotice('已复制路径')
      } catch (error) {
        setNotice(errorMessage(error))
      }
    },
    [selectedPath]
  )

  useEffect(() => {
    if (!hasBrickly() || !selectedPath || !selected?.isFile) {
      setPreview(null)
      setPreviewError('')
      setPreviewLoading(false)
      return
    }
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    setPreviewLoading(true)
    setPreviewError('')
    void previewFile({ path: selectedPath, maxBytes: 20 * 1024, maxEntries: 80 })
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
  }, [selected, selectedPath])

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
    <div className="app-root">
      <TitleBar indexReady={indexReady} statusLabel={healthStatusLabel(health)} statusText={notice} />
      <main className="app-shell">
        <aside className="sidebar">
          <CategoryNav category={category} categoryStats={categoryStats} onSelect={setCategory} />
          <HealthPanel
            health={health}
            starting={starting}
            onRefresh={runHealth}
            onDownload={() => void openDownload()}
            onStart={() => void startEverything()}
          />
        </aside>

        <section className="content">
          <SearchToolbar
            query={query}
            sort={sort}
            loading={loading}
            indexReady={indexReady}
            onQueryChange={setQuery}
            onSortChange={setSort}
            onRefresh={() => void runSearch(page)}
          />

          <WorkspaceSplit
            left={
              <ResultsPane
                health={health}
                reason={reason}
                indexReady={indexReady}
                starting={starting}
                loading={loading}
                result={result}
                query={query}
                selectedPath={selectedPath}
                page={page}
                totalPages={totalPages}
                canPrev={canPrev}
                canNext={canNext}
                getIcon={hasBrickly() ? getFileIcon : undefined}
                onDownload={() => void openDownload()}
                onStart={() => void startEverything()}
                onRecheck={runHealth}
                onSelect={setSelected}
                onOpen={(path) => void openSelected(path)}
                onShowInFolder={(path) => void showSelected(path)}
                onCopyPath={(path) => void copySelectedPath(path)}
                onPage={goPage}
              />
            }
            right={
              <DetailPane
                selected={selected}
                selectedIcon={selectedIcon}
                hasPreview={hasPreview}
                preview={preview}
                previewLoading={previewLoading}
                onOpen={() => void openSelected()}
                onShowInFolder={() => void showSelected()}
                onCopyPath={() => void copySelectedPath()}
              />
            }
          />

          <StatusBar indexReady={indexReady} notice={notice} effectiveQuery={result.effectiveQuery} />
        </section>
      </main>
    </div>
  )
}
