import { Activity, Server } from 'lucide-react'
import type { TestStatus } from '../types'

const STATUS_LABEL: Partial<Record<TestStatus, string>> = {
  pending: '未跑',
  running: '运行中',
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  cancelled: '已取消',
  'waiting-restart': '待重启'
}

export function StatusBar({
  runtimeReady,
  busy,
  focusTitle,
  focusStatus,
  sessionPassed,
  sessionFailed
}: {
  runtimeReady: boolean
  busy: boolean
  focusTitle?: string
  focusStatus?: TestStatus
  sessionPassed: number
  sessionFailed: number
}) {
  return (
    <footer className="statusbar">
      <span className={runtimeReady ? 'ready' : ''}>
        <Server />
        {runtimeReady ? '已就绪' : '连接中…'}
      </span>
      <span>
        <Activity />
        {busy ? '运行中' : focusStatus ? STATUS_LABEL[focusStatus] ?? focusStatus : '空闲'}
        {focusTitle ? ` · ${focusTitle}` : ''}
      </span>
      <div className="status-counts">
        <span>
          本会话通过 <b>{sessionPassed}</b>
        </span>
        <span>
          失败 <b className={sessionFailed ? 'failed' : ''}>{sessionFailed}</b>
        </span>
      </div>
    </footer>
  )
}
