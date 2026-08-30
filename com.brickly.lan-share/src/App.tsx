import { useEffect, useState } from 'react'
import { Share2 } from 'lucide-react'
import { useShareController } from './hooks/useShareController'
import { ControlPanel } from './components/ControlPanel'
import { AccessPanel } from './components/AccessPanel'
import { TransferLog } from './components/TransferLog'
import { formatDuration } from './utils/format'

export function App() {
  const {
    status,
    serviceStatus,
    loading,
    busy,
    operation,
    error,
    start,
    stop,
    saveConfig,
    clearLog
  } = useShareController()

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p className="muted">正在连接共享服务…</p>
      </div>
    )
  }

  if (!status || !serviceStatus) {
    return (
      <div className="app-loading">
        <p className="error-text">{error || '无法获取共享服务状态'}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <Share2 size={18} />
          </span>
          <div>
            <h1>内网文件共享</h1>
            <p className="brand-id mono">{window.brickly?.ref?.brickId ?? 'com.brickly.lan-share'}</p>
          </div>
        </div>
        <StatusBadge
          serviceStatus={serviceStatus}
          running={status.running}
          startedAt={status.startedAt}
          port={status.port}
          operation={operation}
        />
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="app-main">
        <div className="columns">
          <ControlPanel
            status={status}
            serviceStatus={serviceStatus}
            busy={busy}
            onStart={start}
            onStop={stop}
            onSave={saveConfig}
          />
          <AccessPanel status={status} />
        </div>
        <TransferLog entries={status.log} onClear={clearLog} disabled={busy} />
      </main>
    </div>
  )
}

function StatusBadge({
  serviceStatus,
  running,
  startedAt,
  port,
  operation
}: {
  serviceStatus: import('./types').BrickServiceStatus
  running: boolean
  startedAt: number
  port: number
  operation: 'starting' | 'stopping' | 'working' | null
}) {
  const [, force] = useState(0)
  // 运行时每秒刷新一次以更新运行时长。
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => force((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [running])

  const label = statusLabel(serviceStatus, running, operation)

  return (
    <div className={`status-badge ${running ? 'on' : 'off'}`}>
      <span className="status-dot" />
      <div className="status-text">
        <span className="status-label">{label}</span>
        <span className="status-sub mono">
          {running ? `:${port} · ${formatDuration(startedAt)}` : `:${port}`}
        </span>
      </div>
    </div>
  )
}

function statusLabel(
  serviceStatus: import('./types').BrickServiceStatus,
  running: boolean,
  operation: 'starting' | 'stopping' | 'working' | null
): string {
  if (operation === 'starting' || serviceStatus === 'starting' || serviceStatus === 'restarting') {
    return '正在启动'
  }
  if (operation === 'stopping' || serviceStatus === 'stopping') return '正在停止'
  if (serviceStatus === 'error' || serviceStatus === 'crashed') return '启动异常'
  if (serviceStatus === 'running') return running ? '共享中' : '进程运行'
  return '已停止'
}
