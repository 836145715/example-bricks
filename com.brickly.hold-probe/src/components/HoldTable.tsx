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
  Lock,
  Square
} from 'lucide-react'
import React from 'react'
import type { Holder, HolderSource, ProbeResult, SortField, SortOrder } from '../types'

interface HoldTableProps {
  busy: boolean
  result: ProbeResult | null
  holders: Holder[]
  selectedKey: string | null
  copiedPid: number | null
  killingPid: number | null
  detailsLoadingPid: number | null
  sortField: SortField
  sortOrder: SortOrder
  onToggleSort: (field: SortField) => void
  onOpenInspect: (holder: Holder, key: string) => void
  onCopyPid: (pid: number) => void
  onConfirmKill: (pid: number, processName: string, startKey: string) => void
}

function holderKey(holder: Holder, index: number) {
  return `${holder.pid}-${holder.startKey}-${index}`
}

function sourceLabel(source: HolderSource): { text: string; cls: string } {
  if (source === 'restart-manager') return { text: 'RM 锁', cls: 'rm' }
  if (source === 'handle-scan') return { text: '句柄锁', cls: 'hs' }
  if (source === 'process-ref') return { text: '进程引用', cls: 'pr' }
  if (source === 'lsof') return { text: 'lsof 使用', cls: 'pr' }
  return { text: source, cls: '' }
}

function formatTime(value: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 占用矩阵表格组件
 */
export const HoldTable: React.FC<HoldTableProps> = ({
  busy,
  result,
  holders,
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
    <section className="matrix" aria-label="占用进程矩阵表格">
      <div className="matrix-bar">
        <div className="matrix-title">
          <h2>占用矩阵</h2>
          <span className="live-dot" />
        </div>
        <span className="meta">
          {result
            ? `快照时间: ${formatTime(result.probedAt)} · 共 ${holders.length} / ${result.count} 项占用进程 · 点击任意行查看详情`
            : '等待扫描结果'}
        </span>
      </div>

      {busy ? (
        <div className="matrix-loading">
          <div className="skeleton" aria-label="占用扫描加载中">
            {Array.from({ length: 7 }).map((_, i) => (
              <i key={i} />
            ))}
          </div>
        </div>
      ) : !result ? (
        <div className="matrix-empty">
          <Lock size={32} className="warn-icon" />
          <strong>还没有探测结果</strong>
          <span>在上方指定目标路径后点击「开始探测」，使用该路径的进程会展示在这里。</span>
        </div>
      ) : holders.length === 0 ? (
        <div className="matrix-empty">
          <AlertTriangle size={28} className="warn-icon" />
          <strong>{result.count === 0 ? '路径空闲，未发现占用进程' : '没有匹配搜索条件的进程'}</strong>
          <span>
            {result.count === 0
              ? result.kind === 'directory'
                ? '若仍有使用迹象，可勾选「深度扫描」递归检查子目录。'
                : '当前快照未发现进程使用该文件。'
              : '请尝试清空或修改右上角的过滤词。'}
          </span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="socket-table">
            <thead>
              <tr>
                {renderSortHeader('processName', '进程名称')}
                {renderSortHeader('pid', 'PID')}
                {renderSortHeader('sources', '占用来源')}
                {renderSortHeader('applicationType', '应用类型')}
                {renderSortHeader('startedAt', '启动时间')}
                <th>Session ID</th>
                <th style={{ width: 176 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((holder, index) => {
                const key = holderKey(holder, index)
                const isCopied = holder.pid === copiedPid
                const isSelected = selectedKey === key
                const isDetailsLoading = detailsLoadingPid === holder.pid
                const isKilling = killingPid === holder.pid

                return (
                  <tr
                    key={key}
                    className={clsx('is-clickable', isSelected && 'is-selected')}
                    onClick={() => onOpenInspect(holder, key)}
                  >
                    {/* 进程名称 */}
                    <td>
                      <div className="cell">
                        <span className="name">{holder.processName || `PID-${holder.pid}`}</span>
                      </div>
                    </td>

                    {/* PID */}
                    <td>
                      <div className="cell">
                        <span className="main pid-badge">{holder.pid}</span>
                      </div>
                    </td>

                    {/* 占用来源 */}
                    <td>
                      <div className="cell">
                        <div className="source-badges">
                          {(holder.sources || []).map((s) => {
                            const meta = sourceLabel(s)
                            return (
                              <span className={clsx('proto', meta.cls)} key={s}>
                                {meta.text}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    </td>

                    {/* 应用类型 */}
                    <td>
                      <div className="cell">
                        <span className="sub">{holder.applicationType || 'Standard'}</span>
                      </div>
                    </td>

                    {/* 启动时间 */}
                    <td>
                      <div className="cell">
                        <span className="sub">{formatTime(holder.startedAt)}</span>
                      </div>
                    </td>

                    {/* Session ID */}
                    <td>
                      <div className="cell">
                        <span className="sub mono">Session {holder.sessionId}</span>
                      </div>
                    </td>

                    {/* 操作 */}
                    <td>
                      <div className="cell" onClick={(e) => e.stopPropagation()}>
                        <div className="ops">
                          {/* 详情 */}
                          <button
                            type="button"
                            className="icon-btn"
                            title="查看完整进程详情"
                            disabled={isDetailsLoading}
                            onClick={() => onOpenInspect(holder, key)}
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
                            onClick={() => onCopyPid(holder.pid)}
                          >
                            {isCopied ? <Check size={13} /> : <Clipboard size={13} />}
                          </button>

                          {/* 结束进程 */}
                          <button
                            type="button"
                            className="btn btn-danger"
                            title="终止该 PID 对应的进程"
                            disabled={isKilling}
                            onClick={() => onConfirmKill(holder.pid, holder.processName, holder.startKey)}
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
