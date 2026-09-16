import { Eraser } from 'lucide-react'
import type { TransferLogEntry } from '../types'
import { formatBytes, formatTime } from '../utils/format'

interface TransferLogProps {
  entries: TransferLogEntry[]
  onClear: () => void
  disabled: boolean
}

/** 传输日志面板：按时间倒序展示访问来源、方法、路径、状态与字节数。 */
export function TransferLog({ entries, onClear, disabled }: TransferLogProps) {
  return (
    <section className="panel log-panel">
      <header className="panel-head">
        <h2>传输日志</h2>
        <button className="btn ghost sm" onClick={onClear} disabled={disabled || entries.length === 0}>
          <Eraser size={14} /> 清空
        </button>
      </header>

      {entries.length === 0 ? (
        <div className="log-empty muted">暂无访问记录</div>
      ) : (
        <div className="log-table" role="table">
          <div className="log-row log-head" role="row">
            <span>时间</span>
            <span>来源 IP</span>
            <span>方法</span>
            <span className="col-path">路径</span>
            <span className="col-num">状态</span>
            <span className="col-num">大小</span>
          </div>
          {entries.map((entry) => (
            <div className="log-row" role="row" key={entry.id}>
              <span className="mono">{formatTime(entry.at)}</span>
              <span className="mono">{entry.ip || '-'}</span>
              <span className={`method method-${entry.method.toLowerCase()}`}>{entry.method}</span>
              <span className="mono col-path" title={entry.path}>
                {entry.path}
              </span>
              <span className={`col-num status-${statusClass(entry.status)}`}>{entry.status}</span>
              <span className="col-num mono">{formatBytes(entry.bytes)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function statusClass(status: number): string {
  if (status >= 500) return 'err'
  if (status >= 400) return 'warn'
  if (status >= 200 && status < 300) return 'ok'
  return 'info'
}
