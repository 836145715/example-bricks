import { Activity, Server } from 'lucide-react'
import type { RunSnapshot, StatusCounts } from '../types'

export function StatusBar({
  run,
  counts,
  serviceReady,
  focusTitle
}: {
  run?: RunSnapshot
  counts: StatusCounts
  serviceReady: boolean
  focusTitle?: string
}) {
  return (
    <footer className="statusbar">
      <span className={serviceReady ? 'ready' : ''}>
        <Server />
        {serviceReady ? 'Runtime 就绪' : '连接中…'}
      </span>
      <span>
        <Activity />
        {run ? `批次 ${run.status}` : '无活动批次'}
        {focusTitle ? ` · 当前：${focusTitle}` : ''}
      </span>
      <div className="status-counts">
        <span>
          通过 <b>{counts.passed}</b>
        </span>
        <span>
          失败 <b className={counts.failed ? 'failed' : ''}>{counts.failed}</b>
        </span>
        <span>
          跳过 <b>{counts.skipped}</b>
        </span>
        <span>
          运行 <b>{counts.running}</b>
        </span>
      </div>
    </footer>
  )
}
