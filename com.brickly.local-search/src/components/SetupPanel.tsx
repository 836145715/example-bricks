import { Download, ExternalLink, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { healthReason, setupCopy } from '../health'
import type { HealthStatus } from '../types'

export function SetupPanel({
  health,
  starting,
  onDownload,
  onStart,
  onRecheck
}: {
  health: HealthStatus
  starting: boolean
  onDownload: () => void
  onStart: () => void
  onRecheck: () => void
}) {
  const reason = healthReason(health)
  const copy = setupCopy(health)
  return (
    <div className="setup">
      <ShieldAlert size={28} />
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      {copy.steps.length ? (
        <ol>
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      <div className="setup-actions">
        {reason === 'not_running' ? (
          <button type="button" onClick={onStart} disabled={starting || !health.installPath}>
            {starting ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}
            {starting ? '正在启动…' : '启动 Everything'}
          </button>
        ) : reason === 'not_installed' || reason === 'unsupported' ? (
          <button type="button" onClick={onDownload}>
            <Download size={14} />
            打开下载页
          </button>
        ) : null}
        <button className="setup-secondary" type="button" onClick={onRecheck}>
          <RefreshCw size={14} />
          重新检查
        </button>
      </div>
    </div>
  )
}
