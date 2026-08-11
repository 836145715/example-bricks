import { Braces, CircleDashed, Copy, RotateCcw } from 'lucide-react'
import type { RunSnapshot, TestResult } from '../types'
import { formatBytes } from './ResultsTable'

interface ResultDetailsProps {
  run?: RunSnapshot
  result?: TestResult
  busy: boolean
  onRerun(result: TestResult): void
}

export function ResultDetails({ run, result, busy, onRerun }: ResultDetailsProps) {
  const copyDetails = () => result && navigator.clipboard.writeText(JSON.stringify(result, null, 2))
  return <aside className="details-panel">
    <div className="panel-heading"><div><strong>测试详情</strong><span>{run ? shortRunId(run.runId) : '未选择批次'}</span></div>
      {result && <div className="heading-actions"><button title="复制详情" onClick={() => void copyDetails()}><Copy /></button><button title="重新运行" disabled={busy} onClick={() => onRerun(result)}><RotateCcw /></button></div>}
    </div>
    {!result ? <div className="empty-state detail-empty"><CircleDashed /><strong>选择一项结果</strong><span>参数、哈希与脱敏诊断会显示在这里。</span></div> : <div className="details-scroll">
      <div className={`detail-status status-${result.status}`}><Braces /><div><b>{result.title}</b><code>{result.scenarioId}</code></div><span>{result.status}</span></div>
      <dl className="detail-list">
        <Detail label="运行批次" value={run?.runId} mono />
        <Detail label="目标 Runtime" value={result.target ?? '-'} />
        <Detail label="载荷大小" value={formatBytes(result.sizeBytes)} />
        <Detail label="耗时" value={result.durationMs === undefined ? '-' : `${result.durationMs} ms`} />
        <Detail label="分块数" value={result.chunkCount?.toString() ?? '-'} />
        <Detail label="SHA-256" value={result.sha256 ?? '-'} mono />
        <Detail label="错误码" value={result.error?.code ?? '-'} mono />
      </dl>
      {result.hops && <section className="detail-section"><h3>转交链路</h3><div className="hop-list">{result.hops.map((hop, index) => <span key={`${hop}-${index}`}>{hop}</span>)}</div></section>}
      {result.error && <section className="detail-section error-detail"><h3>脱敏诊断</h3><p>{result.error.message}</p></section>}
      {result.skipReason && <section className="detail-section"><h3>跳过原因</h3><p>{result.skipReason}</p></section>}
      {result.resource && <section className="detail-section"><h3>资源元数据</h3><pre>{JSON.stringify(result.resource, null, 2)}</pre></section>}
    </div>}
  </aside>
}

function Detail({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? 'mono' : ''} title={value}>{value ?? '-'}</dd></div>
}
function shortRunId(value: string): string { return value.length > 20 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value }
