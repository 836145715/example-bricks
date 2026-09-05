import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react'
import React, { useEffect } from 'react'

import { formatBytes, shortenPath } from '../format'
import type { TrayItem } from '../hooks/useDiskMap'

interface ConfirmTrashProps {
  open: boolean
  items: TrayItem[]
  trashing: boolean
  failures: string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 移入废纸篓确认弹窗（对齐 port-inspector 的 ConfirmKillModal）。
 * 写明硬链/克隆误差与「进废纸篓可还原」。
 */
export const ConfirmTrash: React.FC<ConfirmTrashProps> = ({
  open,
  items,
  trashing,
  failures,
  onConfirm,
  onCancel
}) => {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !trashing) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, trashing, onCancel])

  if (!open || items.length === 0) return null

  const total = items.reduce((sum, item) => sum + item.allocatedBytes, 0)
  const preview = items.slice(0, 8)

  return (
    <div className="modal-overlay" onClick={trashing ? undefined : onCancel}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-trash-title"
      >
        <div className="modal-head">
          <div className="modal-title-group">
            <span className="modal-icon-badge danger">
              <ShieldAlert size={18} />
            </span>
            <h3 id="confirm-trash-title">移入废纸篓？</h3>
          </div>
          <button type="button" className="icon-btn" disabled={trashing} onClick={onCancel} title="取消">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-target-box">
            <div className="target-row">
              <span className="target-label">项目数</span>
              <span className="target-val">{items.length} 项</span>
            </div>
            <div className="target-row">
              <span className="target-label">预计释放</span>
              <span className="target-val mono">{formatBytes(total)}</span>
            </div>
          </div>

          <ul className="modal-path-list">
            {preview.map((item) => (
              <li key={item.path} title={item.path}>
                <span className="modal-path-name">{item.name}</span>
                <span className="modal-path-full">{shortenPath(item.path.replace(/^\/Users\/[^/]+/, '~'), 46)}</span>
                <span className="modal-path-bytes">{formatBytes(item.allocatedBytes)}</span>
              </li>
            ))}
            {items.length > preview.length && <li className="modal-path-more">…等共 {items.length} 项</li>}
          </ul>

          <div className="modal-warning-text">
            <AlertTriangle size={14} className="warn-icon" />
            <span>
              硬链接与 APFS 克隆可能与其它项目共享存储，实际释放可能少于这个数；项目将移入废纸篓，可随时还原。
            </span>
          </div>

          {failures.length > 0 && (
            <ul className="modal-failures">
              {failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" disabled={trashing} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-danger" disabled={trashing} onClick={onConfirm}>
            {trashing ? <Loader2 className="spin" size={14} /> : null}
            {trashing ? '正在移入废纸篓…' : '确认移入废纸篓'}
          </button>
        </div>
      </div>
    </div>
  )
}
