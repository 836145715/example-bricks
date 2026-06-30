import clsx from 'clsx'
import {
  AlertTriangle,
  Check,
  Clipboard,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Timer,
  X,
  Zap
} from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { resolveAllRecords, resolveDomain } from './brickly'
import type { DnsServerSelection, RecordType, ResolveAllResult, ResolveResult, ServerResult } from './types'

type Mode = 'single' | 'all'
type NoticeKind = 'idle' | 'ok' | 'error'

interface Notice {
  kind: NoticeKind
  text: string
}

const RECORD_TYPES: { value: RecordType; label: string }[] = [
  { value: 'a', label: 'A' },
  { value: 'aaaa', label: 'AAAA' },
  { value: 'cname', label: 'CNAME' },
  { value: 'mx', label: 'MX' },
  { value: 'ns', label: 'NS' },
  { value: 'txt', label: 'TXT' }
]

const DNS_SERVER_OPTIONS: { value: DnsServerSelection; label: string; addr: string }[] = [
  { value: 'auto', label: '全部', addr: '5 servers' },
  { value: 'google', label: 'Google', addr: '8.8.8.8' },
  { value: 'cloudflare', label: 'Cloudflare', addr: '1.1.1.1' },
  { value: 'ali', label: 'AliDNS', addr: '223.5.5.5' },
  { value: 'tencent', label: 'DNSPod', addr: '119.29.29.29' },
  { value: 'system', label: 'System', addr: 'OS' }
]

function normalizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return String(error)
}

function isValidDomain(value: string) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value.trim())
}

function formatRecordValue(record: { type: string; address?: string; value?: string; ttl?: number; priority?: number; exchange?: string }): string {
  if (record.address) return record.address
  if (record.exchange) return `${record.priority ?? 0} → ${record.exchange}`
  if (record.value) return record.value
  return '-'
}

export function App() {
  const [mode, setMode] = useState<Mode>('single')
  const [domain, setDomain] = useState('')
  const [recordType, setRecordType] = useState<RecordType>('a')
  const [dnsServer, setDnsServer] = useState<DnsServerSelection>('auto')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>({ kind: 'idle', text: '输入域名，按回车开始解析' })
  const [singleResult, setSingleResult] = useState<ResolveResult | null>(null)
  const [allResult, setAllResult] = useState<ResolveAllResult | null>(null)
  const [copiedIp, setCopiedIp] = useState<string | null>(null)

  const canResolve = isValidDomain(domain)

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

  async function runResolve() {
    if (!canResolve) {
      setNotice({ kind: 'error', text: '域名格式无效' })
      return
    }
    setBusy(true)
    try {
      const data = await resolveDomain(domain.trim().toLowerCase(), recordType, dnsServer)
      setSingleResult(data)
      setNotice({
        kind: data.uniqueIpCount > 0 ? 'ok' : 'idle',
        text: data.uniqueIpCount > 0
          ? `${data.domain} → ${data.uniqueIpCount} IPs / ${data.totalRecords} records`
          : `${data.domain} → no ${recordType.toUpperCase()} records`
      })
    } catch (error) {
      setNotice({ kind: 'error', text: normalizeError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function runResolveAll() {
    if (!canResolve) {
      setNotice({ kind: 'error', text: '域名格式无效' })
      return
    }
    setBusy(true)
    try {
      const data = await resolveAllRecords(domain.trim().toLowerCase(), dnsServer)
      setAllResult(data)
      setNotice({
        kind: data.uniqueIpCount > 0 ? 'ok' : 'idle',
        text: data.uniqueIpCount > 0
          ? `${data.domain} → ${data.uniqueIpCount} IPs / ${data.totalRecords} records (all types)`
          : `${data.domain} → no DNS records found`
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

  return (
    <main className="dns-app">
      {/* ── Top bar ── */}
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="logo-orb">
            <Globe size={16} />
          </div>
          <div className="top-bar-title">
            <strong>DNS Resolver</strong>
            <span>multi-server cross-lookup</span>
          </div>
        </div>
        <div className="top-bar-right">
          <div className={clsx('status-dot', busy ? 'busy' : okCount > 0 ? 'online' : 'idle')} />
          <span className="status-text">{busy ? 'querying' : okCount > 0 ? 'ready' : 'idle'}</span>
          <button className="refresh-btn" type="button" onClick={refresh} disabled={busy || !canResolve}>
            <RefreshCw size={13} className={busy ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {/* ── Query bar ── */}
      <section className="query-bar">
        <div className="domain-input-wrap">
          <Search size={15} />
          <input
            type="text"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void (mode === 'single' ? runResolve() : runResolveAll())
            }}
            placeholder="example.com"
            autoFocus
          />
          {mode === 'single' && (
            <div className="record-type-pills">
              {RECORD_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  className={clsx('rt-pill', recordType === rt.value && 'active')}
                  type="button"
                  onClick={() => setRecordType(rt.value)}
                >
                  {rt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="query-controls">
          <div className="mode-toggle">
            <button className={clsx(mode === 'single' && 'active')} type="button" onClick={() => setMode('single')}>SINGLE</button>
            <button className={clsx(mode === 'all' && 'active')} type="button" onClick={() => setMode('all')}>ALL</button>
          </div>
          <select className="server-select" value={dnsServer} onChange={(event) => setDnsServer(event.target.value as DnsServerSelection)}>
            {DNS_SERVER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label} {opt.addr}</option>
            ))}
          </select>
          <button
            className="resolve-btn"
            type="button"
            onClick={mode === 'single' ? runResolve : runResolveAll}
            disabled={busy || !canResolve}
          >
            {busy ? <Loader2 className="spin" size={15} /> : <Zap size={15} />}
            RESOLVE
          </button>
        </div>
      </section>

      {/* ── Stats strip ── */}
      <section className="stats-strip">
        <Stat label="UNIQUE IPS" value={uniqueIps.length} accent="green" />
        <div className="stat-sep" />
        <Stat label="RECORDS" value={totalRecords} accent="blue" />
        <div className="stat-sep" />
        <Stat label="SERVERS" value={serverCount} accent="purple" />
        <div className="stat-sep" />
        <Stat label="OK" value={okCount} accent="green" />
        <div className="stat-sep" />
        <Stat label="FAIL" value={failCount} accent="red" />
        <div className="stat-sep" />
        <div className="stat-clock">
          <Timer size={11} />
          <span>{generatedAt}</span>
        </div>
      </section>

      {/* ── Notice ── */}
      <div className={clsx('notice-line', notice.kind)}>
        {notice.kind === 'ok' ? <Check size={12} /> : notice.kind === 'error' ? <X size={12} /> : <AlertTriangle size={12} />}
        <span>{notice.text}</span>
      </div>

      {/* ── IP results ── */}
      {uniqueIps.length > 0 && (
        <section className="ip-strip">
          {uniqueIps.map((ip) => (
            <button
              key={ip}
              className={clsx('ip-chip', copiedIp === ip && 'copied')}
              type="button"
              onClick={() => void copyIp(ip)}
            >
              <code>{ip}</code>
              {copiedIp === ip ? <Check size={11} /> : <Clipboard size={11} />}
            </button>
          ))}
        </section>
      )}

      {/* ── Table ── */}
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

function Stat({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div className={clsx('stat-item', accent)}>
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
            <th>SERVER</th>
            <th>ADDRESS</th>
            <th>RECORDS</th>
            <th>TIME</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.serverKey} className={result.ok ? '' : 'row-fail'}>
              <td>
                <div className="srv-cell">
                  <strong>{result.serverLabel}</strong>
                  <span>{result.serverKey}</span>
                </div>
              </td>
              <td><code className="mono-sm">{result.serverAddress}</code></td>
              <td>
                {result.ok && result.records.length > 0 ? (
                  <div className="rec-list">
                    {result.records.map((record, index) => (
                      <div key={index} className="rec-row">
                        <span className={clsx('rec-tag', record.type.toLowerCase())}>{record.type}</span>
                        <code className="mono-sm">{formatRecordValue(record)}</code>
                        {record.ttl !== undefined && <span className="ttl">{record.ttl}s</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="no-rec">—</span>
                )}
              </td>
              <td>
                <span className="mono-sm ms-cell">{result.elapsedMs}ms</span>
              </td>
              <td>
                {result.ok ? (
                  <span className="chip ok">{result.recordCount}</span>
                ) : (
                  <span className="chip fail" title={result.error ?? undefined}>ERR</span>
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
  const types = Object.keys(byType).filter((type) => byType[type].some((r) => r.ok && r.records.length > 0))

  if (types.length === 0) {
    return <EmptyState hasDomain={true} />
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>TYPE</th>
            <th>SERVER</th>
            <th>VALUE</th>
            <th>TIME</th>
            <th>COUNT</th>
          </tr>
        </thead>
        <tbody>
          {types.flatMap((type) =>
            byType[type].map((result) => ({ type, result, rowKey: `${type}-${result.serverKey}` }))
          )
            .filter(({ result }) => result.ok && result.records.length > 0)
            .map(({ type, result, rowKey }) => (
              <tr key={rowKey}>
                <td><span className={clsx('rec-tag', type.toLowerCase())}>{type}</span></td>
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
                      {record.ttl !== undefined && <span className="ttl">{record.ttl}s</span>}
                    </div>
                    ))}
                  </div>
                </td>
                <td><span className="mono-sm ms-cell">{result.elapsedMs}ms</span></td>
                <td><span className="chip ok">{result.recordCount}</span></td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

function SkeletonTable() {
  return (
    <div className="skeleton-list">
      {Array.from({ length: 8 }).map((_, row) => (
        <div className="skeleton-line" key={row}>
          {Array.from({ length: 5 }).map((__, cell) => (
            <span key={cell} style={{ animationDelay: `${row * 80 + cell * 40}ms` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ hasDomain }: { hasDomain: boolean }) {
  return (
    <div className="empty-zone">
      <div className="empty-pulse">
        <Globe size={28} />
      </div>
      <strong>{hasDomain ? 'NO RECORDS' : 'AWAITING INPUT'}</strong>
      <span>{hasDomain ? 'Try a different record type or server.' : 'Type a domain above and hit RESOLVE.'}</span>
    </div>
  )
}
