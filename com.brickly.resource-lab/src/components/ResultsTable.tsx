import { CircleAlert, CircleCheck, CircleDashed, CirclePause, LoaderCircle, MinusCircle, RotateCcw, XCircle } from 'lucide-react'
import type { TestResult, TestStatus } from '../types'

const STATUS_LABELS: Record<TestStatus, string> = {
  pending: '等待', running: '运行中', passed: '通过', failed: '失败', skipped: '跳过',
  cancelled: '已取消', 'waiting-restart': '待重启'
}

const statusIcons = {
  pending: CircleDashed, running: LoaderCircle, passed: CircleCheck, failed: CircleAlert,
  skipped: MinusCircle, cancelled: XCircle, 'waiting-restart': CirclePause
}

interface ResultsTableProps {
  results: TestResult[]
  selectedId?: string
  busy: boolean
  onSelect(result: TestResult): void
  onRerun(result: TestResult): void
}

export function ResultsTable({ results, selectedId, busy, onSelect, onRerun }: ResultsTableProps) {
  return <section className="results-panel">
    <div className="results-head"><span>状态</span><span>场景</span><span>目标</span><span>载荷</span><span>耗时</span><span>吞吐</span><span>操作</span></div>
    <div className="results-body">
      {results.length === 0 ? <div className="empty-state"><CircleDashed /><strong>尚无测试结果</strong><span>运行默认套件或从左侧选择场景。</span></div> : results.map((result) => {
        const Icon = statusIcons[result.status]
        return <div role="button" tabIndex={0} className={`result-row ${selectedId === result.scenarioId ? 'selected' : ''}`} key={result.scenarioId} onClick={() => onSelect(result)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(result) }}>
          <span className={`status status-${result.status}`}><Icon />{STATUS_LABELS[result.status]}</span>
          <span className="scenario-title" title={result.title}><b>{result.title}</b><code>{result.scenarioId}</code></span>
          <span>{result.target ?? '-'}</span><span>{formatBytes(result.sizeBytes)}</span>
          <span>{formatDuration(result.durationMs)}</span><span>{formatRate(result.throughputBytesPerSecond)}</span>
          <span><button className="row-action" disabled={busy} title="重新运行此场景" onClick={(event) => { event.stopPropagation(); onRerun(result) }}><RotateCcw /></button></span>
        </div>
      })}
    </div>
  </section>
}

export function formatBytes(value?: number): string {
  if (value === undefined) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${(value / 1024 ** 3).toFixed(1)} GiB`
}

function formatDuration(value?: number): string { return value === undefined ? '-' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s` }
function formatRate(value?: number): string { return value === undefined ? '-' : `${formatBytes(value)}/s` }
