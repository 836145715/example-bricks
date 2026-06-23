import clsx from 'clsx'
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  Check,
  Clipboard,
  Cpu,
  Hash,
  Info,
  ListFilter,
  Loader2,
  Network,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  Terminal,
  X
} from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { getProcessDetails, killProcess, listPorts, lookupPort } from './brickly'
import type { KillProcessResult, PortProcessRow, PortQueryResult, ProcessDetails, ProtocolFilter } from './types'

type NoticeKind = 'idle' | 'ok' | 'error'
type Mode = 'port' | 'list'

interface Notice {
  kind: NoticeKind
  text: string
}

const DEFAULT_PORT = 3000
const TABLE_COLUMNS = ['协议', '本地', '进程', 'PID', '状态', '远端', '操作']

function normalizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return String(error)
}

function formatEndpoint(address: string, port: number | null) {
  return `${address || '*'}:${port ?? '*'}`
}

function isValidPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

function uniquePidCount(rows: PortProcessRow[]) {
  return new Set(rows.map((row) => row.pid).filter((pid): pid is number => Number.isInteger(pid))).size
}

function stateTone(row: PortProcessRow) {
  const state = row.state.toUpperCase()
  if (state.includes('LISTEN')) return 'listen'
  if (state.includes('ESTABLISHED')) return 'established'
  return row.protocol
}

export function App() {
  const [mode, setMode] = useState<Mode>('port')
  const [port, setPort] = useState(String(DEFAULT_PORT))
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState<ProtocolFilter>('all')
  const [includeEstablished, setIncludeEstablished] = useState(true)
  const [forceKill, setForceKill] = useState(false)
  const [busy, setBusy] = useState(false)
  const [killingPid, setKillingPid] = useState<number | null>(null)
  const [copiedPid, setCopiedPid] = useState<number | null>(null)
  const [result, setResult] = useState<PortQueryResult | null>(null)
  const [lastKill, setLastKill] = useState<KillProcessResult | null>(null)
  const [details, setDetails] = useState<ProcessDetails | null>(null)
  const [detailsLoadingPid, setDetailsLoadingPid] = useState<number | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [notice, setNotice] = useState<Notice>({ kind: 'idle', text: '输入端口号即可开始排查。' })

  const rows = result?.rows ?? []
  const selectedPort = Number(port)
  const canLookup = isValidPort(selectedPort)
  const platformLabel = result?.platform ?? 'waiting'
  const generatedAt = result ? new Date(result.generatedAt).toLocaleString() : '尚未查询'

  const summary = useMemo(
    () => ({
      records: rows.length,
      processes: uniquePidCount(rows),
      tcp: rows.filter((row) => row.protocol === 'tcp').length,
      udp: rows.filter((row) => row.protocol === 'udp').length
    }),
    [rows]
  )

  async function run(task: () => Promise<PortQueryResult>, successText: (data: PortQueryResult) => string) {
    setBusy(true)
    setLastKill(null)
    try {
      const data = await task()
      setResult(data)
      setNotice({ kind: data.rows.length ? 'ok' : 'idle', text: successText(data) })
    } catch (error) {
      setNotice({ kind: 'error', text: normalizeError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function runLookup() {
    if (!canLookup) {
      setNotice({ kind: 'error', text: '端口号必须是 1 到 65535 之间的整数。' })
      return
    }
    await run(
      () => lookupPort(selectedPort, protocol),
      (data) => (data.rows.length ? `端口 ${selectedPort} 正被 ${uniquePidCount(data.rows)} 个进程占用。` : `端口 ${selectedPort} 当前空闲。`)
    )
  }

  async function runList() {
    await run(
      () =>
        listPorts({
          query,
          protocol,
          includeEstablished,
          limit: 300
        }),
      (data) => (data.rows.length ? `筛选得到 ${data.rows.length} 条端口记录。` : '当前筛选没有匹配记录。')
    )
  }

  async function refresh() {
    if (mode === 'port') await runLookup()
    else await runList()
  }

  async function copyPid(pid: number | null) {
    if (!pid) return
    await navigator.clipboard?.writeText(String(pid))
    setCopiedPid(pid)
    setNotice({ kind: 'ok', text: `已复制 PID ${pid}。` })
    setTimeout(() => setCopiedPid(null), 1500)
  }

  async function copyText(value: string | null, label: string) {
    if (!value) return
    await navigator.clipboard?.writeText(value)
    setNotice({ kind: 'ok', text: `已复制${label}。` })
  }

  async function showDetails(row: PortProcessRow) {
    if (!row.pid) return
    setDetails(null)
    setDetailsOpen(true)
    setDetailsLoadingPid(row.pid)
    try {
      const data = await getProcessDetails(row.pid)
      setDetails(data)
      setNotice({ kind: 'ok', text: `已加载 PID ${row.pid} 的进程详情。` })
    } catch (error) {
      setDetailsOpen(false)
      setNotice({ kind: 'error', text: normalizeError(error) })
    } finally {
      setDetailsLoadingPid(null)
    }
  }

  async function confirmKill(row: PortProcessRow) {
    if (!row.pid) return
    const label = row.processName ? `${row.processName} (PID ${row.pid})` : `PID ${row.pid}`
    const ok = window.confirm(`确定要结束 ${label} 吗？\n\n这会中断该进程正在处理的工作。`)
    if (!ok) return

    setKillingPid(row.pid)
    try {
      const killed = await killProcess(row.pid, forceKill)
      setLastKill(killed)
      setNotice({ kind: 'ok', text: `已发送结束进程指令：PID ${row.pid}。` })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: normalizeError(error) })
    } finally {
      setKillingPid(null)
    }
  }

  useEffect(() => {
    void runLookup()
    // 初次打开按默认端口做一次只读探测。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="workbench">
      <aside className="control-rail">
        <header className="product-mark">
          <span className="mark-box">
            <Terminal size={18} />
          </span>
          <div>
            <h1>端口占用查询</h1>
            <p>定位本机端口、进程与 PID。</p>
          </div>
        </header>

        <section className="panel query-panel" aria-label="查询条件">
          <div className="mode-switch" role="tablist" aria-label="查询模式">
            <button className={clsx(mode === 'port' && 'selected')} type="button" onClick={() => setMode('port')}>
              <Search size={14} />
              查端口
            </button>
            <button className={clsx(mode === 'list' && 'selected')} type="button" onClick={() => setMode('list')}>
              <ListFilter size={14} />
              列全部
            </button>
          </div>

          {mode === 'port' ? (
            <label className="field">
              <span>端口号</span>
              <div className="field-input-wrapper">
                <Hash size={14} />
                <input
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runLookup()
                  }}
                />
              </div>
            </label>
          ) : (
            <label className="field">
              <span>过滤关键字</span>
              <div className="field-input-wrapper">
                <Search size={14} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="端口、PID 或进程名"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runList()
                  }}
                />
              </div>
            </label>
          )}

          <label className="field">
            <span>协议</span>
            <select value={protocol} onChange={(event) => setProtocol(event.target.value as ProtocolFilter)}>
              <option value="all">全部</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </label>

          <label className={clsx('check-line', mode === 'port' && 'disabled')}>
            <input
              type="checkbox"
              checked={includeEstablished}
              onChange={(event) => setIncludeEstablished(event.target.checked)}
              disabled={mode === 'port'}
            />
            <span>包含已建立连接</span>
          </label>

          <button
            className="primary-action"
            type="button"
            onClick={mode === 'port' ? runLookup : runList}
            disabled={busy || (mode === 'port' && !canLookup)}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Network size={16} />}
            {mode === 'port' ? '查询' : '刷新'}
          </button>
        </section>

        <section className="panel risk-panel" aria-label="进程结束选项">
          <div className="panel-heading">
            <ShieldAlert size={16} />
            <span>结束进程</span>
          </div>
          <p>默认发送正常终止信号；仅在进程无响应时勾选强制结束。</p>
          <label className="check-line danger-check">
            <input type="checkbox" checked={forceKill} onChange={(event) => setForceKill(event.target.checked)} />
            <span>强制结束</span>
          </label>
          {lastKill ? (
            <div className="kill-note">
              <AlertTriangle size={12} />
              <span>PID {lastKill.pid} {lastKill.processName ? `· ${lastKill.processName}` : ''} 已终止</span>
            </div>
          ) : null}
        </section>
      </aside>

      <section className="result-stage">
        <header className="stage-header">
          <div>
            <p className="workspace-id">{window.brickly?.brickId ?? 'com.brickly.port-inspector'}</p>
            <h2>本机端口台账</h2>
          </div>
          <button className="secondary-action" type="button" onClick={refresh} disabled={busy}>
            <RefreshCw size={14} />
            刷新
          </button>
        </header>

        <div className="summary-grid" aria-label="查询概览">
          <SummaryItem label="总记录" value={summary.records} icon={<Activity size={16} />} className="records" />
          <SummaryItem label="活跃进程" value={summary.processes} icon={<Cpu size={16} />} className="processes" />
          <SummaryItem label="TCP 占用" value={summary.tcp} icon={<ArrowUpDown size={16} />} className="tcp" />
          <SummaryItem label="UDP 占用" value={summary.udp} icon={<Radio size={16} />} className="udp" />
        </div>

        <section className={clsx('notice-bar', notice.kind)}>
          {notice.kind === 'ok' ? <Check size={14} /> : notice.kind === 'error' ? <X size={14} /> : <AlertTriangle size={14} />}
          <span>{notice.text}</span>
          <code>{platformLabel}</code>
        </section>

        <section className="table-shell">
          <div className="table-toolbar">
            <div>
              <strong>端口记录</strong>
              <span>{generatedAt}</span>
            </div>
            <span>{rows.length} 条记录</span>
          </div>

          {busy ? (
            <SkeletonTable />
          ) : rows.length ? (
            <PortTable
              rows={rows}
              killingPid={killingPid}
              detailsLoadingPid={detailsLoadingPid}
              copiedPid={copiedPid}
              selectedPid={detailsOpen ? (details?.pid ?? detailsLoadingPid) : null}
              onCopyPid={copyPid}
              onDetails={showDetails}
              onKill={confirmKill}
            />
          ) : (
            <EmptyState mode={mode} canLookup={canLookup} />
          )}
        </section>
      </section>

      <ProcessDetailsDialog details={details} loadingPid={detailsLoadingPid} open={detailsOpen} onClose={() => setDetailsOpen(false)} onCopy={copyText} />
    </main>
  )
}

function SummaryItem({ label, value, icon, className }: { label: string; value: number; icon: React.ReactNode; className: string }) {
  return (
    <div className={clsx('summary-item', className)}>
      <div className="summary-item-content">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="summary-item-icon">
        {icon}
      </div>
    </div>
  )
}

function PortTable({
  rows,
  killingPid,
  detailsLoadingPid,
  copiedPid,
  selectedPid,
  onCopyPid,
  onDetails,
  onKill
}: {
  rows: PortProcessRow[]
  killingPid: number | null
  detailsLoadingPid: number | null
  copiedPid: number | null
  selectedPid: number | null
  onCopyPid(pid: number | null): void
  onDetails(row: PortProcessRow): void
  onKill(row: PortProcessRow): void
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {TABLE_COLUMNS.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isCopied = row.pid !== null && row.pid === copiedPid
            return (
              <tr className={clsx(row.pid && row.pid === selectedPid && 'selected-row')} key={`${row.protocol}-${row.localAddress}-${row.localPort}-${row.pid}-${index}`}>
                <td>
                  <span className={clsx('protocol-badge', row.protocol)}>{row.protocol.toUpperCase()}</span>
                </td>
                <td>
                  <div className="endpoint-cell">
                    <strong>{row.localPort}</strong>
                    <span>{row.localAddress}</span>
                  </div>
                </td>
                <td>
                  <div className="process-cell">
                    <strong>{row.processName || '未知进程'}</strong>
                    {!row.processName ? <span>进程名不可读</span> : null}
                  </div>
                </td>
                <td>
                  <code>{row.pid ?? '-'}</code>
                </td>
                <td>
                  <span className={clsx('state-chip', stateTone(row))}>{row.state || 'UDP'}</span>
                </td>
                <td>
                  <code>{formatEndpoint(row.remoteAddress, row.remotePort)}</code>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="icon-button" title="查看进程详情" type="button" disabled={!row.pid} onClick={() => onDetails(row)}>
                      {detailsLoadingPid === row.pid ? <Loader2 className="spin" size={14} /> : <Info size={14} />}
                    </button>
                    <button 
                      className={clsx('icon-button', isCopied && 'success-active')} 
                      title={isCopied ? "已复制 PID" : "复制 PID"} 
                      type="button" 
                      disabled={!row.pid} 
                      onClick={() => onCopyPid(row.pid)}
                    >
                      {isCopied ? <Check size={14} /> : <Clipboard size={14} />}
                    </button>
                    <button className="kill-button" type="button" disabled={!row.pid || killingPid === row.pid} onClick={() => onKill(row)}>
                      {killingPid === row.pid ? <Loader2 className="spin" size={14} /> : <Square size={12} />}
                      结束
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ProcessDetailsDialog({
  details,
  loadingPid,
  open,
  onClose,
  onCopy
}: {
  details: ProcessDetails | null
  loadingPid: number | null
  open: boolean
  onClose(): void
  onCopy(value: string | null, label: string): void
}) {
  if (!open) return null

  const title = details?.processName || (details ? `PID ${details.pid}` : '未选择进程')
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="details-dialog" role="dialog" aria-modal="true" aria-label="进程详情" onClick={(event) => event.stopPropagation()}>
        <header className="details-toolbar">
          <div className="window-decorator-dots">
            <span className="window-dot close" onClick={onClose} />
            <span className="window-dot minimize" />
            <span className="window-dot maximize" />
          </div>
          <div className="details-toolbar-title-box">
            <strong>进程详情</strong>
            <span>{details ? `PID ${details.pid}` : loadingPid ? `PID ${loadingPid}` : '正在读取'}</span>
          </div>
          <button className="icon-button" title="关闭" type="button" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        {loadingPid ? (
          <div className="details-loading">
            <Loader2 className="spin" size={18} />
            <span>读取进程信息</span>
          </div>
        ) : details ? (
          <div className="details-body">
            <div className="details-title">
              <strong>{title}</strong>
              <span>{details.platform}</span>
            </div>

            <dl className="details-grid">
              <DetailField label="父进程" value={formatNullable(details.parentPid)} mono />
              <DetailField label="运行用户" value={details.user} />
              <DetailField label="进程状态" value={details.state} mono />
              <DetailField label="运行时长" value={details.elapsed} mono />
              <DetailField label="启动时间" value={details.startedAt} />
              <DetailField label="采集时间" value={new Date(details.inspectedAt).toLocaleString()} />
            </dl>

            <DetailBlock label="可执行文件路径" value={details.executablePath} onCopy={onCopy} />
            <DetailBlock label="当前工作目录" value={details.workingDirectory} onCopy={onCopy} />
            <DetailBlock label="完整启动命令" value={details.commandLine} onCopy={onCopy} />
          </div>
        ) : (
          <div className="details-empty">
            <Info size={20} />
            <strong>没有进程详情</strong>
            <span>请重新从表格中选择一条记录。</span>
          </div>
        )}
      </section>
    </div>
  )
}

function DetailField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={clsx(mono && 'mono')}>{value || '不可读'}</dd>
    </div>
  )
}

function DetailBlock({
  label,
  value,
  onCopy
}: {
  label: string
  value: string | null
  onCopy(value: string | null, label: string): void
}) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const canCollapse = value !== null && value.length > 90

  const handleCopy = () => {
    if (!value) return
    onCopy(value, label)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="detail-block">
      <div className="detail-block-header">
        <span>{label}</span>
        <div className="detail-block-actions">
          {canCollapse && (
            <button className="collapse-btn" type="button" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? '展开' : '折叠'}
            </button>
          )}
          <button 
            className={clsx('icon-button tiny', copied && 'success-active')} 
            title={`复制${label}`} 
            type="button" 
            disabled={!value} 
            onClick={handleCopy}
          >
            {copied ? <Check size={13} /> : <Clipboard size={13} />}
          </button>
        </div>
      </div>
      <code 
        style={
          canCollapse && collapsed 
            ? { maxHeight: '68px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } 
            : { maxHeight: '200px', overflow: 'auto' }
        }
      >
        {value || '不可读'}
      </code>
    </section>
  )
}

function formatNullable(value: number | null) {
  return Number.isInteger(value) ? String(value) : null
}

function SkeletonTable() {
  return (
    <div className="skeleton-table" aria-label="正在加载">
      {Array.from({ length: 8 }).map((_, row) => (
        <div className="skeleton-row" key={row}>
          {Array.from({ length: 7 }).map((__, cell) => (
            <span key={cell} />
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ mode, canLookup }: { mode: Mode; canLookup: boolean }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon-container">
        <AlertTriangle size={20} />
      </div>
      <strong>{mode === 'port' && !canLookup ? '端口号无效' : '没有端口占用记录'}</strong>
      <span>{mode === 'port' && !canLookup ? '请输入 1 到 65535 之间的整数。' : '换一个端口或清空过滤条件后再试。'}</span>
    </div>
  )
}
