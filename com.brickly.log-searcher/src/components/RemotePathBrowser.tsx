import { ArrowUp, Check, ChevronRight, FileText, Folder, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatLogFileSize } from '../domain/logFiles'
import {
  BROWSE_SHORTCUTS,
  formatBrowseEntryMeta,
  splitRemotePathSegments,
  toDirectoryGlob,
  type RemoteBrowseEntry,
  type RemoteBrowseResult
} from '../domain/paths'

interface RemotePathBrowserProps {
  initialPath: string
  onBrowse: (path: string) => Promise<RemoteBrowseResult>
  onPick: (paths: string[]) => void
  onClose: () => void
}

type BrowseStatus = 'loading' | 'ready' | 'error'

const normalizeBrowseResult = (result: RemoteBrowseResult): RemoteBrowseResult => ({
  ...result,
  entries: Array.isArray(result.entries) ? result.entries : []
})

export function RemotePathBrowser({
  initialPath,
  onBrowse,
  onPick,
  onClose
}: RemotePathBrowserProps) {
  const [address, setAddress] = useState(initialPath || '/var/log')
  const [result, setResult] = useState<RemoteBrowseResult | null>(null)
  const [status, setStatus] = useState<BrowseStatus>('loading')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const load = async (path: string) => {
    setStatus('loading')
    setMessage('')
    setSelected([])
    try {
      const next = normalizeBrowseResult(await onBrowse(path))
      setResult(next)
      setAddress(next.pattern || next.path || path)
      setStatus('ready')
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setMessage(text)
      setStatus('error')
    }
  }

  useEffect(() => {
    void load(initialPath || '/var/log')
  }, [])

  const currentPath = result?.path || address
  const segments = splitRemotePathSegments(currentPath)
  const selectedSet = new Set(selected)
  const visibleEntries = result?.entries ?? []
  const files = visibleEntries.filter(entry => entry.kind === 'file')

  const toggleFile = (path: string) => {
    setSelected(prev => prev.includes(path) ? prev.filter(item => item !== path) : [...prev, path])
  }

  const handleOpen = (entry: RemoteBrowseEntry) => {
    if (entry.kind === 'dir') {
      void load(entry.path)
      return
    }
    toggleFile(entry.path)
  }

  return (
    <div className="remote-browser">
      <div className="remote-browser-toolbar">
        <button
          className="btn btn-secondary"
          type="button"
          disabled={!result?.parent}
          onClick={() => result?.parent && void load(result.parent)}
          title="上级目录"
        >
          <ArrowUp size={13} />
          上级
        </button>
        <div className="remote-browser-address">
          <input
            value={address}
            onChange={event => setAddress(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && void load(address.trim())}
            placeholder="/var/log 或 /var/log/nginx/*.log"
            spellCheck={false}
          />
          <button className="btn btn-secondary" type="button" onClick={() => void load(address.trim())}>
            转到
          </button>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => void load(address.trim())} title="刷新">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="remote-browser-shortcuts">
        {BROWSE_SHORTCUTS.map(item => (
          <button key={item.path} type="button" onClick={() => void load(item.path)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="remote-browser-crumbs" aria-label="当前路径">
        {segments.map((segment, index) => (
          <span key={segment.path}>
            {index > 0 && <ChevronRight size={11} />}
            <button type="button" onClick={() => void load(segment.path)}>
              {segment.label}
            </button>
          </span>
        ))}
      </div>

      {result?.pattern && (
        <div className="remote-browser-banner">
          通配符 <code>{result.pattern}</code> 匹配到 {files.length} 个文件
        </div>
      )}
      {result?.truncated && (
        <div className="remote-browser-banner warn">当前目录条目较多，只显示前 400 项</div>
      )}

      <div className="remote-browser-list">
        {status === 'loading' && <div className="remote-browser-empty">正在读取远程目录…</div>}
        {status === 'error' && (
          <div className="remote-browser-empty error">
            <p>{message || '浏览失败'}</p>
            <button className="btn btn-secondary" type="button" onClick={() => void load(address.trim())}>
              重试
            </button>
          </div>
        )}
        {status === 'ready' && visibleEntries.length === 0 && (
          <div className="remote-browser-empty">这个目录没有可显示的文件或子目录</div>
        )}
        {status === 'ready' && visibleEntries.map(entry => {
          const isFile = entry.kind === 'file'
          const checked = selectedSet.has(entry.path)
          return (
            <div
              key={entry.path}
              className={`remote-browser-item ${checked ? 'selected' : ''} ${!isFile ? 'is-dir' : ''}`}
            >
              {isFile ? (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFile(entry.path)}
                />
              ) : (
                <span className="remote-browser-spacer" />
              )}
              <button
                type="button"
                className="remote-browser-open"
                onClick={() => handleOpen(entry)}
                onDoubleClick={() => {
                  if (isFile) onPick([entry.path])
                }}
                title={entry.path}
              >
                {isFile ? <FileText size={14} /> : <Folder size={14} />}
                <span className="remote-browser-name">{entry.name}</span>
                <span className="remote-browser-meta">
                  {formatBrowseEntryMeta(entry) || (entry.sizeBytes !== undefined ? formatLogFileSize(entry.sizeBytes) : '')}
                </span>
                {isFile && entry.searchable === false && <span className="remote-browser-tag">可能不可检索</span>}
              </button>
            </div>
          )
        })}
      </div>

      <div className="remote-browser-footer">
        <div className="remote-browser-footer-actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!currentPath}
            onClick={() => onPick([toDirectoryGlob(currentPath, '*')])}
          >
            添加此目录 /*
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!currentPath}
            onClick={() => onPick([toDirectoryGlob(currentPath, '*.log')])}
          >
            添加 *.log
          </button>
          {result?.pattern && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => onPick([result.pattern!])}
            >
              使用该通配符
            </button>
          )}
        </div>
        <div className="remote-browser-footer-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            返回
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={selected.length === 0}
            onClick={() => onPick(selected)}
          >
            <Check size={14} />
            添加选中 {selected.length > 0 ? selected.length : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
