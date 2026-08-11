import { Activity, Database, Server } from 'lucide-react'
import type { RunSnapshot, StatusCounts } from '../types'

export function StatusBar({ run, counts, serviceReady }: { run?: RunSnapshot; counts: StatusCounts; serviceReady: boolean }) {
  return <footer className="statusbar">
    <span className={serviceReady ? 'ready' : ''}><Server />{serviceReady ? 'Runtime 就绪' : 'Runtime 连接中'}</span>
    <span><Activity />{run ? `批次 ${run.status}` : '无活动批次'}</span>
    <div className="status-counts"><span>通过 <b>{counts.passed}</b></span><span>失败 <b className={counts.failed ? 'failed' : ''}>{counts.failed}</b></span><span>跳过 <b>{counts.skipped}</b></span><span>运行 <b>{counts.running}</b></span></div>
    <span className="storage"><Database />store-and-forward</span>
  </footer>
}
