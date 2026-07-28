import { FormEvent, useMemo, useRef, useState } from 'react'
import {
  fetchProcessInfo,
  getPathForFile,
  pickDirectory,
  pickFile,
  probePath,
  stopProcess,
} from './brickly'
import type { Holder, ProbeResult, ProcessDetails } from './types'

type Tone = 'idle' | 'ok' | 'warn' | 'err' | 'busy'

function errorMessage(error: unknown): string {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown }
    const msg = e.message != null ? String(e.message) : String(error)
    const code = e.code != null ? String(e.code) : ''
    if (code && !msg.includes(code)) return `[${code}] ${msg}`
    return msg
  }
  return String(error)
}

function formatTime(value: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

function baseName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function sourceLabel(source: string): { text: string; cls: string } {
  if (source === 'restart-manager') return { text: 'RM', cls: 'rm' }
  if (source === 'handle-scan') return { text: '句柄', cls: 'hs' }
  if (source === 'process-ref') return { text: '进程引用', cls: 'pr' }
  return { text: source, cls: '' }
}

export function App() {
  const [path, setPath] = useState('')
  const [deep, setDeep] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const [detailHolder, setDetailHolder] = useState<Holder | null>(null)
  const [details, setDetails] = useState<ProcessDetails | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [stopTarget, setStopTarget] = useState<Holder | null>(null)
  const [force, setForce] = useState(false)
  const [stopLoading, setStopLoading] = useState(false)
  const [stopError, setStopError] = useState('')
  const requestRef = useRef(0)

  const status = useMemo((): { tone: Tone; text: string } => {
    if (loading) return { tone: 'busy', text: deep ? '深度扫描中…' : '探测中…' }
    if (error) return { tone: 'err', text: error }
    if (!result) return { tone: 'idle', text: '等待目标路径' }
    if (result.count === 0) return { tone: 'ok', text: '未发现占用进程' }
    return { tone: 'warn', text: `发现 ${result.count} 个占用进程` }
  }, [loading, error, result, deep])

  async function runProbe(nextPath = path) {
    const clean = nextPath.trim()
    if (!clean) {
      setError('请先输入或选择文件 / 文件夹路径。')
      return
    }
    if (!window.brickly?.invoke) {
      setError('window.brickly.invoke 不可用：runtime 未注入。请确认在 Brickly 中打开，并已构建 bin/win-x64/brick.exe。')
      return
    }
    const id = ++requestRef.current
    setPath(clean)
    setLoading(true)
    setError('')
    setResult(null)
    const started = performance.now()
    try {
      console.info('[hold-probe] probe start', { path: clean, deep })
      const data = await probePath(clean, deep)
      if (id !== requestRef.current) return
      console.info('[hold-probe] probe done', {
        ms: Math.round(performance.now() - started),
        count: data.count,
      })
      setResult(data)
      setPath(data.path || clean)
    } catch (caught) {
      if (id !== requestRef.current) return
      console.error('[hold-probe] probe error', caught)
      setError(errorMessage(caught))
    } finally {
      if (id === requestRef.current) setLoading(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void runProbe()
  }

  async function onPickFile() {
    try {
      const selected = await pickFile()
      if (selected) {
        setPath(selected)
        setResult(null)
        setError('')
      }
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function onPickDir() {
    try {
      const selected = await pickDirectory()
      if (selected) {
        setPath(selected)
        setResult(null)
        setError('')
      }
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) {
      setError('拖放内容无效，请拖入单个文件或文件夹。')
      return
    }
    try {
      const dropped = getPathForFile(file)
      if (!dropped) {
        setError('无法解析拖放路径（宿主可能不支持文件夹拖放）。')
        return
      }
      setPath(dropped)
      setError('')
      void runProbe(dropped)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function openDetails(holder: Holder) {
    setDetailHolder(holder)
    setDetails(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const info = await fetchProcessInfo(holder.pid, holder.startKey)
      setDetails(info)
    } catch (caught) {
      setDetailError(errorMessage(caught))
    } finally {
      setDetailLoading(false)
    }
  }

  async function confirmStop() {
    if (!stopTarget) return
    setStopLoading(true)
    setStopError('')
    try {
      const res = await stopProcess(stopTarget.pid, stopTarget.startKey, force)
      setStopTarget(null)
      setForce(false)
      const msg = res.alreadyExited ? '进程已退出，正在刷新…' : '进程已结束，正在刷新…'
      setError('')
      // soft notice via status after re-probe
      await runProbe(path)
      if (!error) {
        // keep result; status will update
      }
      void msg
    } catch (caught) {
      const msg = errorMessage(caught)
      if (msg.includes('PROCESS_NOT_FOUND') || msg.toLowerCase().includes('not found')) {
        setStopTarget(null)
        await runProbe(path)
      } else {
        setStopError(msg)
      }
    } finally {
      setStopLoading(false)
    }
  }

  const overlayOpen = detailHolder !== null || stopTarget !== null

  return (
    <div
      className="shell"
      onDragEnter={(e) => {
        e.preventDefault()
        if (!overlayOpen) setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!overlayOpen) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        if (overlayOpen) {
          e.preventDefault()
          return
        }
        handleDrop(e)
      }}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            ⌕
          </div>
          <div>
            <h1>占用探针</h1>
            <p>Windows · 文件 / 文件夹占用探测</p>
          </div>
        </div>
        <div className="badge-row">
          <span className="chip">
            引擎 <strong>Win32 API</strong>
          </span>
          <span className="chip">
            平台 <strong>win-x64 / arm64</strong>
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail">
          <form className="panel" onSubmit={onSubmit}>
            <h2>目标</h2>
            <div className={`dropzone${dragging ? ' active' : ''}`}>
              <span className="hint-title">{dragging ? '松开以探测' : '拖放到此处'}</span>
              <span className="hint-sub">支持单个文件；文件夹视宿主能力</span>
            </div>
            <input
              className="path-input"
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setResult(null)
                setError('')
              }}
              placeholder="C:\path\to\file-or-folder"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="btn-row">
              <button className="btn" type="button" onClick={() => void onPickFile()}>
                选文件
              </button>
              <button className="btn" type="button" onClick={() => void onPickDir()}>
                选文件夹
              </button>
              <button className="btn btn-primary" type="submit" disabled={loading || !path.trim()}>
                {loading ? <span className="spin" /> : null}
                {loading ? '探测中' : '开始探测'}
              </button>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={deep}
                onChange={(e) => setDeep(e.target.checked)}
              />
              <span>
                <span className="label">深度扫描（句柄枚举）</span>
                <span className="desc">
                  默认关闭。开启后更慢，最多约 20 秒会超时返回；一般目录占用无需勾选。
                </span>
              </span>
            </label>
          </form>

          <div className="panel">
            <h2>当前目标</h2>
            <div className="meta-block">
              <div className="meta-row">
                <span>名称</span>
                <code>{path ? baseName(path) : '—'}</code>
              </div>
              <div className="meta-row">
                <span>类型</span>
                <code>
                  {result?.kind === 'directory' ? '文件夹' : result?.kind === 'file' ? '文件' : '—'}
                </code>
              </div>
              <div className="meta-row">
                <span>路径</span>
                <code>{path || '尚未指定'}</code>
              </div>
              <div className="meta-row">
                <span>时间</span>
                <code>{result ? formatTime(result.probedAt) : '—'}</code>
              </div>
              <div className="meta-row">
                <span>深度</span>
                <code>{result ? (result.deepUsed ? '已启用' : '未使用') : deep ? '将启用' : '关闭'}</code>
              </div>
            </div>
          </div>
        </aside>

        <main className="stage">
          <div className="status-strip">
            <span className={`pill ${status.tone}`}>
              {status.tone === 'busy' ? <span className="spin" /> : null}
              {status.text}
            </span>
            {result ? (
              <button className="btn btn-ghost" type="button" disabled={loading} onClick={() => void runProbe()}>
                重新探测
              </button>
            ) : null}
          </div>

          {result?.notes && result.notes.length > 0 ? (
            <div className="notes">
              探测备注
              <ul>
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!result && !loading ? (
            <div className="empty">
              <div className="glyph">🔒</div>
              <h3>还没有探测结果</h3>
              <p>在左侧指定路径后点击「开始探测」。占用进程会以卡片形式展示在这里。</p>
            </div>
          ) : null}

          {loading ? (
            <div className="empty">
              <div className="spin" style={{ width: 28, height: 28, borderWidth: 3 }} />
              <h3 style={{ marginTop: 16 }}>正在扫描占用关系</h3>
              <p>{deep ? '句柄枚举可能需要数秒…' : '调用 Restart Manager…'}</p>
            </div>
          ) : null}

          {result && !loading && result.count === 0 ? (
            <div className="empty">
              <div className="glyph">✓</div>
              <h3>没有进程占用该路径</h3>
              <p>
                {result.kind === 'directory'
                  ? '若仍无法删除目录，可勾选「深度扫描」再试一次。'
                  : '文件当前可被其它程序打开或删除。'}
              </p>
            </div>
          ) : null}

          {result && !loading && result.count > 0 ? (
            <div className="cards">
              {result.holders.map((holder) => (
                <article className="card" key={`${holder.pid}-${holder.startKey}`}>
                  <div className="card-head">
                    <h3 className="proc-name">{holder.processName || `pid-${holder.pid}`}</h3>
                    <span className="pid-badge">PID {holder.pid}</span>
                  </div>
                  <div className="tags">
                    {(holder.sources || []).map((s) => {
                      const meta = sourceLabel(s)
                      return (
                        <span className={`tag ${meta.cls}`} key={s}>
                          {meta.text}
                        </span>
                      )
                    })}
                    {holder.applicationType ? <span className="tag">{holder.applicationType}</span> : null}
                    {holder.startedAt ? <span className="tag">{formatTime(holder.startedAt)}</span> : null}
                  </div>
                  <div className="card-actions">
                    <button className="btn" type="button" onClick={() => void openDetails(holder)}>
                      详情
                    </button>
                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() => {
                        setStopTarget(holder)
                        setForce(false)
                        setStopError('')
                      }}
                    >
                      结束
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </main>
      </div>

      {detailHolder ? (
        <div className="overlay" role="presentation" onClick={() => setDetailHolder(null)}>
          <div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="进程详情"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h3>{detailHolder.processName}</h3>
                <p className="sub">PID {detailHolder.pid}</p>
              </div>
              <button className="btn" type="button" onClick={() => setDetailHolder(null)}>
                关闭
              </button>
            </header>
            {detailLoading ? <p style={{ color: 'var(--muted)' }}>读取中…</p> : null}
            {detailError ? <div className="warning-box">{detailError}</div> : null}
            {details ? (
              <div className="detail-grid">
                <div className="detail-item">
                  <label>可执行路径</label>
                  <div>{details.executablePath || '不可读'}</div>
                </div>
                <div className="detail-item">
                  <label>命令行</label>
                  <pre>{details.commandLine || '不可读'}</pre>
                </div>
                <div className="detail-item">
                  <label>用户</label>
                  <div>{details.user || '不可读'}</div>
                </div>
                <div className="detail-item">
                  <label>父进程 / 会话</label>
                  <div>
                    PPID {details.parentPid || '—'} · Session {details.sessionId}
                  </div>
                </div>
                <div className="detail-item">
                  <label>启动时间</label>
                  <div>{formatTime(details.startedAt)}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {stopTarget ? (
        <div className="overlay" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-label="确认结束进程">
            <header>
              <div>
                <h3>确认结束进程？</h3>
                <p className="sub">
                  {baseName(path)} ← {stopTarget.processName} (PID {stopTarget.pid})
                </p>
              </div>
            </header>
            <div className="warning-box">
              结束进程可能丢失未保存数据。默认发送正常结束请求；勾选强制后使用 /F。
            </div>
            <label className="force-row">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              强制结束（taskkill /F）
            </label>
            {stopError ? <div className="warning-box">{stopError}</div> : null}
            <div className="modal-actions">
              <button
                className="btn"
                type="button"
                disabled={stopLoading}
                onClick={() => {
                  setStopTarget(null)
                  setForce(false)
                  setStopError('')
                }}
              >
                取消
              </button>
              <button className="btn btn-danger" type="button" disabled={stopLoading} onClick={() => void confirmStop()}>
                {stopLoading ? '执行中…' : force ? '强制结束' : '结束进程'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
