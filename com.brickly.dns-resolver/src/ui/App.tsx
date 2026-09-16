import clsx from 'clsx'
import {
  AlertTriangle,
  Check,
  Clipboard,
  Globe2,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Timer,
  X,
  Zap
} from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { resolveAllRecords, resolveDomain } from './brickly'
import { parseDomainInput } from './parseDomain'
import type {
  DnsServerSelection,
  RecordType,
  ResolveAllResult,
  ResolveResult,
  ServerResult
} from './types'

type Mode = 'single' | 'all'
type NoticeKind = 'idle' | 'ok' | 'error'

interface Notice {
  kind: NoticeKind
  text: string
}

const RECORD_TYPES: { value: RecordType; label: string; title: string }[] = [
  { value: 'a', label: 'A', title: 'IPv4' },
  { value: 'aaaa', label: 'AAAA', title: 'IPv6' },
  { value: 'cname', label: 'CNAME', title: '别名' },
  { value: 'mx', label: 'MX', title: '邮件' },
  { value: 'ns', label: 'NS', title: '权威' },
  { value: 'txt', label: 'TXT', title: '文本' }
]

const DNS_SERVER_OPTIONS: { value: DnsServerSelection; label: string; addr: string }[] = [
  { value: 'auto', label: '全部', addr: '5 源' },
  { value: 'google', label: 'Google', addr: '8.8.8.8' },
  { value: 'cloudflare', label: 'Cloudflare', addr: '1.1.1.1' },
  { value: 'ali', label: 'AliDNS', addr: '223.5.5.5' },
  { value: 'tencent', label: 'DNSPod', addr: '119.29.29.29' },
  { value: 'system', label: '系统', addr: 'OS' }
]

function normalizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return String(error)
}

function formatRecordValue(record: {
  type: string
  address?: string
  value?: string
  ttl?: number
  priority?: number
  exchange?: string
}): string {
  if (record.address) return record.address
  if (record.exchange) return `${record.priority ?? 0} → ${record.exchange}`
  if (record.value) return record.value
  return '-'
}

export function App() {
  const [mode, setMode] = useState<Mode>('single')
  const [input, setInput] = useState('')
  const [recordType, setRecordType] = useState<RecordType>('a')
  const [dnsServer, setDnsServer] = useState<DnsServerSelection>('auto')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>({
    kind: 'idle',
    text: '粘贴域名或完整网址，按回车开始解析'
  })
  const [singleResult, setSingleResult] = useState<ResolveResult | null>(null)
  const [allResult, setAllResult] = useState<ResolveAllResult | null>(null)
  const [copiedIp, setCopiedIp] = useState<string | null>(null)

  const parsed = useMemo(() => parseDomainInput(input), [input])
  const canResolve = Boolean(parsed.domain)

  const uniqueIps = useMemo(() => {
    if (mode === 'single') return singleResult?.uniqueIps ?? []
    return allResult?.uniqueIps ?? []
  }, [mode, singleResult, allResult])

  const totalRecords = useMemo(() => {
    if (mode === 'single') return singleResult?.totalRecords ?? 0
    return allResult?.totalRecords ?? 0
  }, [mode, singleResult, allResult])

  const serverCount = useMemo(() => {
    if (mode === 'single') return singleResult?.serverCount ?? 0
    return allResult?.serverCount ?? 0
  }, [mode, singleResult, allResult])

  const generatedAt = useMemo(() => {
    const raw = mode === 'single' ? singleResult?.generatedAt : allResult?.generatedAt
    return raw ? new Date(raw).toLocaleTimeString() : '--:--:--'
  }, [mode, singleResult, allResult])

  const resolvedDomain = mode === 'single' ? singleResult?.domain : allResult?.domain

  async function runResolve() {
    if (!parsed.domain) {
      setNotice({ kind: 'error', text: parsed.hint || '域名格式无效' })
      return
    }
    setBusy(true)
    try {
      const data = await resolveDomain(parsed.domain, recordType, dnsServer)
      setSingleResult(data)
      setNotice({
        kind: data.uniqueIpCount > 0 ? 'ok' : 'idle',
        text:
          data.uniqueIpCount > 0
            ? `${data.domain} → ${data.uniqueIpCount} 个 IP / ${data.totalRecords} 条记录`
            : `${data.domain} → 无 ${recordType.toUpperCase()} 记录`
      })
    } catch (error) {
      setNotice({ kind: 'error', text: normalizeError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function runResolveAll() {
    if (!parsed.domain) {
      setNotice({ kind: 'error', text: parsed.hint || '域名格式无效' })
      return
    }
    setBusy(true)
    try {
      const data = await resolveAllRecords(parsed.domain, dnsServer)
      setAllResult(data)
      setNotice({
        kind: data.uniqueIpCount > 0 ? 'ok' : 'idle',
        text:
          data.uniqueIpCount > 0
            ? `${data.domain} → ${data.uniqueIpCount} 个 IP / ${data.totalRecords} 条记录（全部类型）`
            : `${data.domain} → 未找到 DNS 记录`
      })
    } catch (error) {
      setNotice({ kind: 'error', text: normalizeError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function refresh() {
    if (mode === 'single') await runResolve()
    else await runResolveAll()
  }

  async function copyIp(ip: string) {
    await navigator.clipboard?.writeText(ip)
    setCopiedIp(ip)
    setTimeout(() => setCopiedIp(null), 1500)
  }

  const activeResults: ServerResult[] = useMemo(() => {
    if (mode === 'single') return singleResult?.results ?? []
    if (!allResult) return []
    return Object.values(allResult.byType).flat()
  }, [mode, singleResult, allResult])

  const okCount = activeResults.filter((r) => r.ok).length
  const failCount = activeResults.filter((r) => !r.ok).length
  const statusLabel = busy ? '查询中' : okCount > 0 ? '就绪' : '空闲'

  return (
    <main className="dns-app">
      <div className="ambient ambient-a" aria-hidden />
      <div className="ambient ambient-b" aria-hidden />

      <header className="top-bar">
        <div className="top-bar-left">
          <div className="logo-mark" aria-hidden>
            <Globe2 size={16} strokeWidth={1.75} />
          </div>
          <div className="top-bar-title">
            <strong>域名真实 IP 查找</strong>
            <span>多源 DNS 交叉解析</span>
          </div>
        </div>
        <div className="top-bar-right">
          <div className={clsx('status-pill', busy ? 'busy' : okCount > 0 ? 'online' : 'idle')}>
            <span className="status-dot" />
            <span>{statusLabel}</span>
          </div>
          <button
            className="icon-btn"
            type="button"
            title="重新查询"
            onClick={() => void refresh()}
            disabled={busy || !canResolve}
          >
            <RefreshCw size={14} strokeWidth={1.75} className={busy ? 'spin' : undefined} />
          </button>
        </div>
      </header>

      <section className="query-panel">
        <div className="query-labels">
          <label className="field-label" htmlFor="domain-input">
            域名或网址
          </label>
          <span className="field-label">模式</span>
          <span className="field-label">DNS 源</span>
          <span className="field-label field-label-spacer" aria-hidden>
            &nbsp;
          </span>
        </div>

        <div className="query-row">
          <div
            className={clsx(
              'domain-field',
              parsed.source === 'invalid' && input.trim() && 'is-invalid',
              parsed.source === 'url' && 'is-url',
              parsed.source === 'domain' && canResolve && 'is-valid'
            )}
          >
            <Search size={16} strokeWidth={1.75} className="field-icon" />
            <input
              id="domain-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void (mode === 'single' ? runResolve() : runResolveAll())
                }
              }}
              placeholder="example.com 或 https://xdcx.ahzmwl.com/bbxy/login"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {input.trim() ? (
              <button className="clear-btn" type="button" title="清空" onClick={() => setInput('')}>
                <X size={13} strokeWidth={2} />
              </button>
            ) : null}
          </div>

          <div className="seg" role="tablist" aria-label="解析模式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'single'}
              className={clsx(mode === 'single' && 'active')}
              onClick={() => setMode('single')}
            >
              单类型
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'all'}
              className={clsx(mode === 'all' && 'active')}
              onClick={() => setMode('all')}
            >
              全量
            </button>
          </div>

          <select
            className="select"
            value={dnsServer}
            onChange={(e) => setDnsServer(e.target.value as DnsServerSelection)}
            aria-label="DNS 源"
          >
            {DNS_SERVER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} · {opt.addr}
              </option>
            ))}
          </select>

          <button
            className="resolve-btn"
            type="button"
            onClick={() => void (mode === 'single' ? runResolve() : runResolveAll())}
            disabled={busy || !canResolve}
          >
            {busy ? (
              <Loader2 className="spin" size={15} strokeWidth={2} />
            ) : (
              <Zap size={15} strokeWidth={2} />
            )}
            解析
          </button>
        </div>

        <div className="parse-row">
          {parsed.source === 'url' && parsed.domain ? (
            <div className="parse-chip is-url">
              <Link2 size={12} strokeWidth={2} />
              <span>
                识别域名 <code>{parsed.domain}</code>
              </span>
            </div>
          ) : parsed.source === 'domain' && parsed.domain ? (
            <div className="parse-chip is-ok">
              <Check size={12} strokeWidth={2} />
              <span>
                将解析 <code>{parsed.domain}</code>
              </span>
            </div>
          ) : parsed.source === 'invalid' && input.trim() ? (
            <div className="parse-chip is-err">
              <AlertTriangle size={12} strokeWidth={2} />
              <span>{parsed.hint}</span>
            </div>
          ) : (
            <p className="parse-hint">{parsed.hint}</p>
          )}
        </div>

        {mode === 'single' ? (
          <div className="record-types">
            <span className="field-label">记录类型</span>
            <div className="rt-row">
              {RECORD_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  type="button"
                  title={rt.title}
                  className={clsx('rt-pill', recordType === rt.value && 'active')}
                  onClick={() => setRecordType(rt.value)}
                >
                  <span className="rt-label">{rt.label}</span>
                  <span className="rt-sub">{rt.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="metrics" aria-label="解析统计">
        <Metric label="唯一 IP" value={uniqueIps.length} tone="ac" />
        <Metric label="记录数" value={totalRecords} tone="muted" />
        <Metric label="DNS 源" value={serverCount} tone="muted" />
        <Metric label="成功" value={okCount} tone="ok" />
        <Metric label="失败" value={failCount} tone={failCount > 0 ? 'danger' : 'muted'} />
        <div className="metric-meta">
          <Timer size={12} strokeWidth={1.75} />
          <span>{generatedAt}</span>
          {resolvedDomain ? (
            <>
              <span className="dot" />
              <code>{resolvedDomain}</code>
            </>
          ) : null}
        </div>
      </section>

      <div className={clsx('notice', notice.kind)} role="status">
        {notice.kind === 'ok' ? (
          <Check size={13} strokeWidth={2} />
        ) : notice.kind === 'error' ? (
          <X size={13} strokeWidth={2} />
        ) : (
          <AlertTriangle size={13} strokeWidth={2} />
        )}
        <span>{notice.text}</span>
      </div>

      {uniqueIps.length > 0 ? (
        <section className="ip-strip" aria-label="唯一 IP">
          {uniqueIps.map((ip) => (
            <button
              key={ip}
              type="button"
              className={clsx('ip-chip', copiedIp === ip && 'copied')}
              title="点击复制"
              onClick={() => void copyIp(ip)}
            >
              <code>{ip}</code>
              {copiedIp === ip ? (
                <Check size={12} strokeWidth={2} />
              ) : (
                <Clipboard size={12} strokeWidth={1.75} />
              )}
            </button>
          ))}
        </section>
      ) : null}

      <section className="table-area">
        {busy ? (
          <SkeletonTable />
        ) : mode === 'single' ? (
          singleResult && singleResult.results.length > 0 ? (
            <SingleResultTable results={singleResult.results} />
          ) : (
            <EmptyState hasDomain={canResolve} />
          )
        ) : allResult ? (
          <AllResultTable byType={allResult.byType} />
        ) : (
          <EmptyState hasDomain={canResolve} />
        )}
      </section>
    </main>
  )
}

function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: number | string
  tone: 'ac' | 'ok' | 'danger' | 'muted'
}) {
  return (
    <div className={clsx('metric', tone)}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function SingleResultTable({ results }: { results: ServerResult[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>服务器</th>
            <th>地址</th>
            <th>记录</th>
            <th>耗时</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.serverKey} className={result.ok ? undefined : 'row-fail'}>
              <td>
                <div className="srv-cell">
                  <strong>{result.serverLabel}</strong>
                  <span>{result.serverKey}</span>
                </div>
              </td>
              <td>
                <code className="mono-sm">{result.serverAddress}</code>
              </td>
              <td>
                {result.ok && result.records.length > 0 ? (
                  <div className="rec-list">
                    {result.records.map((record, index) => (
                      <div key={index} className="rec-row">
                        <span className={clsx('rec-tag', record.type.toLowerCase())}>{record.type}</span>
                        <code className="mono-sm">{formatRecordValue(record)}</code>
                        {record.ttl !== undefined ? <span className="ttl">{record.ttl}s</span> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="no-rec">-</span>
                )}
              </td>
              <td>
                <span className="mono-sm ms-cell">{result.elapsedMs}ms</span>
              </td>
              <td>
                {result.ok ? (
                  <span className="chip ok">{result.recordCount}</span>
                ) : (
                  <span className="chip fail" title={result.error ?? undefined}>
                    失败
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AllResultTable({ byType }: { byType: Record<string, ServerResult[]> }) {
  const types = Object.keys(byType).filter((type) =>
    byType[type].some((r) => r.ok && r.records.length > 0)
  )

  if (types.length === 0) return <EmptyState hasDomain />

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>类型</th>
            <th>服务器</th>
            <th>值</th>
            <th>耗时</th>
            <th>数量</th>
          </tr>
        </thead>
        <tbody>
          {types
            .flatMap((type) =>
              byType[type].map((result) => ({
                type,
                result,
                rowKey: `${type}-${result.serverKey}`
              }))
            )
            .filter(({ result }) => result.ok && result.records.length > 0)
            .map(({ type, result, rowKey }) => (
              <tr key={rowKey}>
                <td>
                  <span className={clsx('rec-tag', type.toLowerCase())}>{type}</span>
                </td>
                <td>
                  <div className="srv-cell">
                    <strong>{result.serverLabel}</strong>
                    <span>{result.serverAddress}</span>
                  </div>
                </td>
                <td>
                  <div className="rec-list">
                    {result.records.map((record, index) => (
                      <div key={index} className="rec-row">
                        <code className="mono-sm">{formatRecordValue(record)}</code>
                        {record.ttl !== undefined ? <span className="ttl">{record.ttl}s</span> : null}
                      </div>
                    ))}
                  </div>
                </td>
                <td>
                  <span className="mono-sm ms-cell">{result.elapsedMs}ms</span>
                </td>
                <td>
                  <span className="chip ok">{result.recordCount}</span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

function SkeletonTable() {
  return (
    <div className="skeleton-list" aria-hidden>
      {Array.from({ length: 7 }).map((_, row) => (
        <div className="skeleton-line" key={row}>
          {Array.from({ length: 5 }).map((__, cell) => (
            <span key={cell} style={{ animationDelay: `${row * 70 + cell * 35}ms` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ hasDomain }: { hasDomain: boolean }) {
  return (
    <div className="empty-zone">
      <div className="empty-orb">
        <span className="ring r1" />
        <span className="ring r2" />
        <Globe2 size={26} strokeWidth={1.5} />
      </div>
      <strong>{hasDomain ? '暂无记录' : '等待输入'}</strong>
      <span>
        {hasDomain
          ? '换一种记录类型或 DNS 源再试。'
          : '支持直接粘贴网址，例如 https://xdcx.ahzmwl.com/bbxy/login'}
      </span>
    </div>
  )
}
