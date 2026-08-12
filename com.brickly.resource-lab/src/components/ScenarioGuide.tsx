import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  LoaderCircle,
  MinusCircle,
  Play,
  RotateCcw,
  Target,
  ListOrdered,
  HelpCircle,
  XCircle
} from 'lucide-react'
import type { ScenarioDefinition, TestResult, TestStatus } from '../types'
import { getScenarioGuide } from '../scenario-docs'
import { formatBytes } from './format'

const STATUS_LABEL: Record<TestStatus, string> = {
  pending: '未运行',
  running: '运行中',
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  cancelled: '已取消',
  'waiting-restart': '待重启'
}

const statusIcon = {
  pending: CircleDashed,
  running: LoaderCircle,
  passed: CircleCheck,
  failed: CircleAlert,
  skipped: MinusCircle,
  cancelled: XCircle,
  'waiting-restart': CirclePause
}

interface ScenarioGuideProps {
  scenario?: ScenarioDefinition
  result?: TestResult
  busy: boolean
  onRun(): void
  onRerun(): void
}

export function ScenarioGuidePanel({ scenario, result, busy, onRun, onRerun }: ScenarioGuideProps) {
  if (!scenario) {
    return (
      <section className="guide-panel empty">
        <div className="empty-state">
          <CircleDashed />
          <strong>选择一个场景</strong>
          <span>从左侧点选场景，查看目标、原因与测试流程，然后单独运行。</span>
        </div>
      </section>
    )
  }

  const guide = getScenarioGuide(scenario.id)
  const status = result?.status
  const Icon = status ? statusIcon[status] : Target
  const canRerun = Boolean(result) && !busy

  return (
    <section className="guide-panel">
      <header className="guide-hero">
        <div className="guide-hero-text">
          <p className="eyebrow">{scenario.group} · {scenario.mode}{scenario.exclusive ? ' · 独占' : ''}</p>
          <h2>{scenario.title}</h2>
          <code>{scenario.id}</code>
          <div className="guide-tags">
            {scenario.target && <span className="tag">目标 {scenario.target}</span>}
            {scenario.sizeBytes !== undefined && (
              <span className="tag">载荷 {formatBytes(scenario.sizeBytes)}</span>
            )}
            {scenario.requirements?.map((r) => (
              <span className="tag warn" key={r}>
                需要 {r}
              </span>
            ))}
          </div>
        </div>
        <div className="guide-actions">
          <button type="button" className="primary large" disabled={busy} onClick={onRun}>
            <Play /> {busy && status === 'running' ? '运行中…' : '运行此场景'}
          </button>
          {canRerun && (
            <button type="button" className="ghost" disabled={busy} onClick={onRerun}>
              <RotateCcw /> 再跑一次
            </button>
          )}
        </div>
      </header>

      {status && (
        <div className={`result-banner status-${status}`}>
          <Icon className={status === 'running' ? 'spin' : undefined} />
          <div>
            <strong>{STATUS_LABEL[status]}</strong>
            <span>
              {result?.durationMs !== undefined ? `${result.durationMs} ms` : '—'}
              {result?.sha256 ? ` · sha256 ${result.sha256.slice(0, 12)}…` : ''}
            </span>
          </div>
        </div>
      )}

      {result?.error && (
        <div className="error-card" role="alert">
          <div className="error-card-head">
            <AlertTriangle />
            <div>
              <strong>场景失败</strong>
              <code>{result.error.code}</code>
            </div>
          </div>
          <p className="error-message">{result.error.message}</p>
          {guide.commonFailures && guide.commonFailures.length > 0 && (
            <div className="error-hints">
              <h4>排查提示</h4>
              <ul>
                {guide.commonFailures.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <details className="error-raw">
            <summary>完整结果 JSON</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}

      {result?.skipReason && (
        <div className="skip-card">
          <MinusCircle />
          <div>
            <strong>已跳过</strong>
            <p>{result.skipReason}</p>
          </div>
        </div>
      )}

      <div className="guide-grid">
        <article className="guide-card">
          <h3>
            <Target /> 目标
          </h3>
          <p>{guide.goal}</p>
          {guide.successLooksLike && (
            <p className="muted">
              <strong>成功时：</strong>
              {guide.successLooksLike}
            </p>
          )}
        </article>
        <article className="guide-card">
          <h3>
            <HelpCircle /> 为什么测
          </h3>
          <p>{guide.why}</p>
        </article>
      </div>

      <article className="guide-card steps-card">
        <h3>
          <ListOrdered /> 测试流程
        </h3>
        <ol className="step-list">
          {guide.steps.map((step, index) => (
            <li key={index}>
              <span className="step-index">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </article>

      {result && !result.error && status === 'passed' && (
        <article className="guide-card success-metrics">
          <h3>
            <CircleCheck /> 本次结果摘要
          </h3>
          <dl className="metric-grid">
            <div>
              <dt>耗时</dt>
              <dd>{result.durationMs ?? '—'} ms</dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd>{formatBytes(result.sizeBytes)}</dd>
            </div>
            <div>
              <dt>分块</dt>
              <dd>{result.chunkCount ?? '—'}</dd>
            </div>
            <div>
              <dt>吞吐</dt>
              <dd>
                {result.throughputBytesPerSecond
                  ? `${formatBytes(result.throughputBytesPerSecond)}/s`
                  : '—'}
              </dd>
            </div>
            {result.sha256 && (
              <div className="wide">
                <dt>SHA-256</dt>
                <dd className="mono">{result.sha256}</dd>
              </div>
            )}
            {result.hops && (
              <div className="wide">
                <dt>链路</dt>
                <dd className="hop-list">
                  {result.hops.map((hop, i) => (
                    <span key={`${hop}-${i}`}>{hop}</span>
                  ))}
                </dd>
              </div>
            )}
            {result.resource && (
              <div className="wide">
                <dt>资源元数据（Ref 摘要，无 token）</dt>
                <dd>
                  <pre className="mini-pre">{JSON.stringify(result.resource, null, 2)}</pre>
                </dd>
              </div>
            )}
          </dl>
          {isRecord(result.transfer) && <TransferPanel transfer={result.transfer} />}
          {isRecord(result.payload) && !result.transfer && (
            <TransferPanel
              transfer={{
                received: result.payload,
                transport: isRecord(result.transport) ? result.transport : undefined
              }}
            />
          )}
          {result.json !== undefined && (
            <div className="payload-block">
              <h4>JSON 正文</h4>
              <pre className="mini-pre">{JSON.stringify(result.json, null, 2)}</pre>
            </div>
          )}
        </article>
      )}
    </section>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function TransferPanel({ transfer }: { transfer: Record<string, unknown> }) {
  const sent = isRecord(transfer.sent) ? transfer.sent : undefined
  const received = isRecord(transfer.received) ? transfer.received : undefined
  const transport = isRecord(transfer.transport) ? transfer.transport : undefined
  const peer = isRecord(transfer.peer) ? transfer.peer : undefined
  return (
    <div className="transfer-panel">
      <h4>传输内容预览</h4>
      {typeof transfer.note === 'string' && <p className="transfer-note">{transfer.note}</p>}
      {typeof transfer.sentDescription === 'string' && (
        <p className="transfer-note">{transfer.sentDescription}</p>
      )}
      <div className="transfer-columns">
        {sent && (
          <PayloadCard
            title="发送 / 期望"
            payload={sent}
            description={typeof sent.description === 'string' ? sent.description : undefined}
          />
        )}
        {received && <PayloadCard title="读回 / 对端" payload={received} />}
      </div>
      {transport && (
        <div className="payload-block">
          <h4>分块传输</h4>
          <p className="transfer-note">
            {typeof transport.note === 'string' ? transport.note : null}
            {Array.isArray(transport.firstChunkSizes)
              ? ` · 分块大小: [${(transport.firstChunkSizes as number[]).join(', ')}] 字节`
              : null}
            {typeof transport.chunkCount === 'number' ? ` · 总块数 ${transport.chunkCount}` : null}
          </p>
        </div>
      )}
      {peer && (
        <div className="payload-block">
          <h4>对端回报</h4>
          <pre className="mini-pre">{JSON.stringify(peer, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function PayloadCard({
  title,
  payload,
  description
}: {
  title: string
  payload: Record<string, unknown>
  description?: string
}) {
  const utf8 = typeof payload.utf8 === 'string' ? payload.utf8 : undefined
  const hex = typeof payload.hex === 'string' ? payload.hex : undefined
  const note = typeof payload.note === 'string' ? payload.note : description
  return (
    <div className="payload-card">
      <header>
        <strong>{title}</strong>
        <span>
          {typeof payload.totalBytes === 'number' ? `${payload.totalBytes} B` : ''}
          {payload.truncated ? ' · 已截断' : ''}
          {typeof payload.encoding === 'string' ? ` · ${payload.encoding}` : ''}
        </span>
      </header>
      {note && <p className="transfer-note">{note}</p>}
      {utf8 !== undefined && (
        <div className="payload-block">
          <h4>UTF-8 文本</h4>
          <pre className="payload-text">{utf8 || '（空）'}</pre>
        </div>
      )}
      {hex !== undefined && (
        <div className="payload-block">
          <h4>Hex</h4>
          <pre className="payload-hex">{hex || '（空）'}</pre>
        </div>
      )}
      {!utf8 && !hex && description && <p className="transfer-note">{description}</p>}
    </div>
  )
}
