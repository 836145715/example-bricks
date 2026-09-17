import {
  ArrowUpRight,
  Copy,
  Folder,
  FileText,
  Link2,
  Package,
  RotateCw,
  Search,
  X
} from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { doSearch, hasBrickly, pickScopeDirectory, queryStatus, reindex, revealInFinder, startRuntime } from './brickly'
import { TitleBar } from './components/TitleBar'
import { formatDate, highlightParts, highlightTerms, humanSize } from './format'
import { fullPath, SearchItem, StatusInfo } from './types'

const SEARCH_DEBOUNCE_MS = 120
const STATUS_POLL_MS = 600
const MAX_RENDER_ROWS = 300

const typeIcon = (type: number): React.ReactNode => {
  if (type === 2) return <Folder size={16} className="row-ico row-ico-dir" />
  if (type === 5) return <Package size={16} className="row-ico row-ico-app" />
  if (type === 3) return <Link2 size={16} className="row-ico row-ico-link" />
  return <FileText size={16} className="row-ico" />
}

export function App(): React.ReactElement {
  const [handle, setHandle] = useState<Awaited<ReturnType<typeof startRuntime>> | null>(null)
  const [bootError, setBootError] = useState('')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('')
  const [items, setItems] = useState<SearchItem[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [selected, setSelected] = useState(0)
  const [copied, setCopied] = useState('')

  const seqRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 启动 owned runtime
  useEffect(() => {
    if (!hasBrickly()) {
      setBootError('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用')
      return
    }
    let cancelled = false
    startRuntime()
      .then((h) => {
        if (!cancelled) setHandle(h)
      })
      .catch((err) => {
        if (!cancelled) setBootError(String(err?.message ?? err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 引擎状态轮询（Go 侧另有 500ms 节流，这里 600ms 拉一次够用）
  useEffect(() => {
    if (!handle) return
    let stopped = false
    const tick = () => {
      queryStatus(handle)
        .then((s) => {
          if (!stopped) setStatus(s)
        })
        .catch(() => undefined)
    }
    tick()
    const timer = window.setInterval(tick, STATUS_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [handle])

  // 即输即搜（latest-wins）
  useEffect(() => {
    if (!handle) return
    const q = query.trim()
    if (q === '') {
      setItems([])
      setElapsed(0)
      setSearching(false)
      return
    }
    const seq = ++seqRef.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      doSearch(handle, q, scope)
        .then((res) => {
          if (seqRef.current !== seq) return
          setItems(res.items ?? [])
          setElapsed(res.elapsedMs ?? 0)
          setSelected(0)
          setSearching(false)
        })
        .catch(() => {
          if (seqRef.current !== seq) return
          setItems([])
          setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [handle, query, scope])

  const terms = useMemo(() => highlightTerms(query), [query])

  const reveal = useCallback((item: SearchItem) => revealInFinder(fullPath(item)), [])

  const copyPath = useCallback((item: SearchItem) => {
    const p = fullPath(item)
    void navigator.clipboard?.writeText(p).then(() => {
      setCopied(p)
      window.setTimeout(() => setCopied(''), 1200)
    })
  }, [])

  // 键盘：↑↓ 选择，Enter 在 Finder 显示
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter' && items[selected]) {
        e.preventDefault()
        reveal(items[selected])
      }
    },
    [items, selected, reveal]
  )

  // 选中项滚入视野
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const scanning = status?.scanning ?? false
  const indexed = status?.liveRecords ?? status?.records ?? 0

  if (bootError) {
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="boot-error">{bootError}</div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TitleBar />

      <div className="toolbar">
        <div className="searchbox">
          <Search size={16} className="searchbox-ico" aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            spellCheck={false}
            value={query}
            placeholder="全盘搜索，如 report ext:pdf · path:下载 size:>10mb"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {query !== '' && (
            <button type="button" className="searchbox-clear" title="清空" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        {scope ? (
          <span className="scope-chip" title={scope}>
            {scope}
            <button type="button" onClick={() => setScope('')} aria-label="移除目录限定">
              <X size={12} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="scope-add"
            title="限定搜索目录"
            disabled={!handle}
            onClick={() => {
              void pickScopeDirectory().then((dir) => {
                if (dir) setScope(dir)
              })
            }}
          >
            限定目录…
          </button>
        )}
      </div>

      <div className="results" ref={listRef}>
        {query.trim() === '' ? (
          <div className="empty-hint">
            <p className="empty-title">输入即搜 · ↑↓ 选择 · Enter 在访达显示 · 双击同</p>
            <p className="empty-sub">
              支持多关键词（空格 = AND）与过滤器：
              <code>ext:pdf</code> <code>size:&gt;10mb</code> <code>path:下载</code>{' '}
              <code>dm:today</code> <code>regex:report\d+</code> <code>infile:关键词</code>
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-hint">
            {searching || scanning ? <p className="empty-title">搜索中…</p> : <p className="empty-title">无匹配结果</p>}
            {scanning && <p className="empty-sub">首次全盘索引进行中，结果会随索引逐步完整。</p>}
          </div>
        ) : (
          items.slice(0, MAX_RENDER_ROWS).map((item, idx) => {
            const p = fullPath(item)
            return (
              <div
                key={p}
                data-idx={idx}
                className={`row${idx === selected ? ' row-selected' : ''}`}
                onMouseEnter={() => setSelected(idx)}
                onDoubleClick={() => reveal(item)}
              >
                {typeIcon(item.type)}
                <div className="row-main">
                  <span className="row-name">
                    {highlightParts(item.name, terms).map((part, i) =>
                      part.hit ? (
                        <mark key={i}>{part.text}</mark>
                      ) : (
                        <span key={i}>{part.text}</span>
                      )
                    )}
                  </span>
                  <span className="row-path" title={p}>
                    {item.path || '/'}
                  </span>
                </div>
                <span className="row-size">{item.type === 2 ? '—' : humanSize(item.size)}</span>
                <span className="row-time">{formatDate(item.mtime)}</span>
                <div className="row-actions">
                  <button type="button" title="复制路径" onClick={() => copyPath(item)}>
                    <Copy size={13} />
                  </button>
                  <button type="button" title="在访达中显示" onClick={() => reveal(item)}>
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <footer className="statusbar">
        <span className={`status-dot ${status?.engineReady ? (scanning ? 'dot-busy' : 'dot-ok') : 'dot-wait'}`} aria-hidden />
        <span className="status-text">
          {status === null
            ? '连接引擎…'
            : !status.engineReady
              ? (status.error ?? '引擎未就绪')
              : scanning
                ? `全盘索引中 · 已扫描 ${status.scanScanned.toLocaleString()} 项`
                : `已索引 ${indexed.toLocaleString()} 条 · 实时监控${status.monitoring ? '开' : '关'}`}
        </span>
        <span className="status-spacer" />
        {query.trim() !== '' && items.length > 0 && (
          <span className="status-meta">
            {items.length.toLocaleString()} 条 · {elapsed < 1 ? '<1' : Math.round(elapsed)} ms
          </span>
        )}
        <button
          type="button"
          className="status-action"
          title="丢弃缓存并全盘重扫"
          disabled={!handle}
          onClick={() => {
            void reindex(handle!)
          }}
        >
          <RotateCw size={12} /> 重建索引
        </button>
      </footer>

      {copied && <div className="toast">已复制路径</div>}
    </div>
  )
}
