import { CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { healthReason, healthStatusLabel } from '../health'
import type { HealthStatus } from '../types'

export function HealthPanel({
  health,
  starting,
  onRefresh,
  onDownload,
  onStart
}: {
  health: HealthStatus | null
  starting: boolean
  onRefresh: () => void
  onDownload: () => void
  onStart: () => void
}) {
  const ok = Boolean(health?.ok)
  const reason = healthReason(health)
  return (
    <section className="health">
      <div className="health-title">
        {ok ? (
          <CheckCircle2 size={15} className="health-ok" />
        ) : reason === 'indexing' ? (
          <Loader2 size={15} className="spin health-warn" />
        ) : (
          <ShieldAlert size={15} className="health-warn" />
        )}
        <span>{healthStatusLabel(health)}</span>
        <button type="button" onClick={onRefresh} title="检查状态">
          <RefreshCw size={12} />
        </button>
      </div>
      {ok ? null : <p>{health?.everythingError || health?.error || '等待状态检查'}</p>}
      {reason === 'not_installed' || reason === 'unsupported' ? (
        <button className="health-link" type="button" onClick={onDownload}>
          打开下载页
        </button>
      ) : null}
      {reason === 'not_running' ? (
        <button className="health-link" type="button" onClick={onStart} disabled={starting || !health?.installPath}>
          {starting ? '正在启动…' : '启动 Everything'}
        </button>
      ) : null}
    </section>
  )
}
