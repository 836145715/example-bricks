import clsx from 'clsx'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clipboard,
  Info,
  Loader2,
  Square
} from 'lucide-react'
import React from 'react'
import type { Mode, PortProcessRow, SortField, SortOrder } from '../types'

interface PortTableProps {
  mode: Mode
  busy: boolean
  canLookup: boolean
  rows: PortProcessRow[]
  generatedAt: string
  selectedKey: string | null
  copiedPid: number | null
  killingPid: number | null
  detailsLoadingPid: number | null
  sortField: SortField
  sortOrder: SortOrder
  onToggleSort: (field: SortField) => void
  onOpenInspect: (row: PortProcessRow, key: string) => void
  onCopyPid: (pid: number | null) => void
  onConfirmKill: (pid: number, processName?: string | null) => void
}

function rowKey(row: PortProcessRow, index: number) {
  return `${row.protocol}-${row.localAddress}-${row.localPort}-${row.pid}-${index}`
}

function stateClass(row: PortProcessRow) {
  const state = (row.state || '').toUpperCase()
  if (state.includes('LISTEN')) return 'listen'
  if (state.includes('ESTABLISHED')) return 'estab'
  return ''
}

function stateLabel(row: PortProcessRow) {
  if (!row.state) return row.protocol === 'udp' ? 'UDP 监听' : '—'
  return row.state
}

function formatEndpoint(address: string, port: number | null) {
  return `${address || '*'}:${port ?? '*'}`
}

/**
 * 端口连接矩阵表格组件
 */
export const PortTable: React.FC<PortTableProps> = ({
  mode,
  busy,
  canLookup,
  rows,
  generatedAt,
  selectedKey,
  copiedPid,
  killingPid,
  detailsLoadingPid,
  sortField,
  sortOrder,
  onToggleSort,
  onOpenInspect,
  onCopyPid,
  onConfirmKill
}) => {
  const renderSortHeader = (field: SortField, label: string) => {
    const isCurrent = sortField === field
    return (
      <th
        key={field}
        className={clsx('sortable-th', isCurrent && 'active-sort')}
        onClick={() => onToggleSort(field)}
        title={`按${label}${isCurrent && sortOrder === 'asc' ? '降序' : '升序'}排列`}
      >
        <div className="th-content">
          <span>{label}</span>
          <span className="sort-icon">
            {isCurrent ? (
              sortOrder === 'asc' ? (
                <ArrowUp size={12} />
              ) : (
                <ArrowDown size={12} />
              )
            ) : (
              <ArrowUpDown size={11} className="sort-idle" />
            )}
          </span>
        </div>
      </th>
    )
  }

  return (
    <section className="matrix" aria-label="连接矩阵表格">
      <div className="matrix-bar">
        <div className="matrix-title">
          <h2>连接矩阵</h2>
          <span className="live-dot" />
        </div>
        <span className="meta">
          快照时间: {generatedAt} · 共 {rows.length} 行记录 · 点击任意行可查看详细进程
        </span>
      </div>

      {busy ? (
        <div className="matrix-loading">
          <div className="skeleton" aria-label="数据扫描加载中">
            {Array.from({ length: 8 }).map((_, i) => (
              <i key={i} />
            ))}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="matrix-empty">
          <AlertTriangle size={24} className="warn-icon" />
          <strong>{mode === 'port' && !canLookup ? '端口号输入无效' : '暂未发现匹配的端口连接'}</strong>
          <span>
            {mode === 'port' && !canLookup
              ? '请输入 1～65535 之间的整数端口。'
              : '当前端口空闲，或换个端口号、协议/过滤条件再扫描一次。'}
          </span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="socket-table">
            <thead>
              <tr>
                {renderSortHeader('protocol', '协议')}
                {renderSortHeader('localPort', '本地端口/地址')}
                {renderSortHeader('processName', '进程名称')}
                {renderSortHeader('pid', 'PID')}
                {renderSortHeader('state', '连接状态')}
                <th>远端地址</th>
                <th style={{ width: 176 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const key = rowKey(row, index)
                const tone = stateClass(row)
                const canAct = Boolean(row.pid)
                const isCopied = row.pid !== null && row.pid === copiedPid
                const isSelected = selectedKey === key
                const isDetailsLoading = row.pid !== null && detailsLoadingPid === row.pid
                const isKilling = row.pid !== null && killingPid === row.pid

                return (
                  <tr
                    key={key}
                    className={clsx(
                      tone === 'listen' && 'is-listen',
                      tone === 'estab' && 'is-estab',
                      isSelected && 'is-selected',
                      canAct && 'is-clickable'
                    )}
                    onClick={() => {
                      if (canAct) onOpenInspect(row, key)
                    }}
                  >
                    {/* 协议 */}
                    <td>
                      <div className="cell">
                        <span className={clsx('proto', row.protocol)}>{row.protocol.toUpperCase()}</span>
                      </div>
                    </td>

                    {/* 本地地址与端口 */}
                    <td>
                      <div className="cell stack">
                        <span className="main port-num">{row.localPort}</span>
                        <span className="sub">{row.localAddress}</span>
                      </div>
                    </td>

                    {/* 进程名称 */}
                    <td>
                      <div className="cell stack">
                        <span className="name" title={row.processName || row.executablePath || undefined}>
                          {row.processName || '未知进程'}
                        </span>
                        <span className="sub path-text" title={row.executablePath || undefined}>
                          {row.executablePath
                            ? row.executablePath.length > 36
                              ? `…${row.executablePath.slice(-34)}`
                              : row.executablePath
                            : '路径无读取权限'}
                        </span>
                      </div>
                    </td>

                    {/* PID */}
                    <td>
                      <div className="cell">
                        <span className="main pid-badge">{row.pid ?? '—'}</span>
                      </div>
                    </td>

                    {/* 状态 */}
                    <td>
                      <div className="cell">
                        <span className={clsx('state-dot', tone)}>
                          <i />
                          {stateLabel(row)}
                        </span>
                      </div>
                    </td>

                    {/* 远端地址 */}
                    <td>
                      <div className="cell">
                        <span className="main remote-text">
                          {formatEndpoint(row.remoteAddress, row.remotePort)}
                        </span>
                      </div>
                    </td>

                    {/* 操作按钮 */}
                    <td>
                      <div className="cell" onClick={(e) => e.stopPropagation()}>
                        <div className="ops">
                          {/* 详情 */}
                          <button
                            type="button"
                            className="icon-btn"
                            title="查看完整进程详情"
                            disabled={!canAct || isDetailsLoading}
                            onClick={() => onOpenInspect(row, key)}
                          >
                            {isDetailsLoading ? (
                              <Loader2 className="spin" size={13} />
                            ) : (
                              <Info size={13} />
                            )}
                          </button>

                          {/* 复制 PID */}
                          <button
                            type="button"
                            className={clsx('icon-btn', isCopied && 'ok')}
                            title="复制 PID 到剪贴板"
                            disabled={!row.pid}
                            onClick={() => onCopyPid(row.pid)}
                          >
                            {isCopied ? <Check size={13} /> : <Clipboard size={13} />}
                          </button>

                          {/* 强杀进程 */}
                          <button
                            type="button"
                            className="btn btn-danger"
                            title="终止该 PID 对应的进程"
                            disabled={!canAct || isKilling}
                            onClick={() => {
                              if (row.pid) onConfirmKill(row.pid, row.processName)
                            }}
                          >
                            {isKilling ? (
                              <Loader2 className="spin" size={12} />
                            ) : (
                              <Square size={11} />
                            )}
                            结束
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
