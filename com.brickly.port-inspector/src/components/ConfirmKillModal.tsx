import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'

interface ConfirmKillModalProps {
  open: boolean
  pid: number | null
  processName?: string | null
  /** windows | macos | …；Windows 不展示强制选项 */
  platform?: string
  killing: boolean
  onConfirm: (force: boolean) => void
  onCancel: () => void
}

function isWindowsPlatform(platform?: string) {
  if (platform === 'windows') return true
  if (platform === 'macos' || platform === 'linux') return false
  // 尚未扫描时用 UA 兜底
  if (typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)) return true
  return false
}

/**
 * 结束进程确认弹窗：macOS 可勾选强制；Windows 始终强制，不展示选项。
 */
export const ConfirmKillModal: React.FC<ConfirmKillModalProps> = ({
  open,
  pid,
  processName,
  platform,
  killing,
  onConfirm,
  onCancel
}) => {
  const windows = isWindowsPlatform(platform)
  const [force, setForce] = useState(false)

  // 每次打开弹窗重置为默认（温和结束）
  useEffect(() => {
    if (open) setForce(false)
  }, [open, pid])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !killing) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, killing, onCancel])

  if (!open || pid === null) return null

  const label = processName ? `${processName}` : `PID ${pid}`
  const effectiveForce = windows || force

  return (
    <div className="modal-overlay" onClick={killing ? undefined : onCancel}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="modal-head">
          <div className="modal-title-group">
            <span className="modal-icon-badge danger">
              <ShieldAlert size={18} />
            </span>
            <h3 id="confirm-modal-title">确定结束此进程？</h3>
          </div>
          <button type="button" className="icon-btn" disabled={killing} onClick={onCancel} title="取消">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-target-box">
            <div className="target-row">
              <span className="target-label">进程名称</span>
              <strong className="target-val">{label}</strong>
            </div>
            <div className="target-row">
              <span className="target-label">进程 PID</span>
              <span className="target-val mono">{pid}</span>
            </div>
            <div className="target-row">
              <span className="target-label">结束方式</span>
              <span className={`target-val badge ${effectiveForce ? 'force' : 'normal'}`}>
                {windows
                  ? '强制终止（Windows）'
                  : effectiveForce
                    ? '强制结束（SIGKILL）'
                    : '正常结束（SIGTERM）'}
              </span>
            </div>
          </div>

          {!windows ? (
            <label className="modal-force-check">
              <input
                type="checkbox"
                checked={force}
                disabled={killing}
                onChange={(e) => setForce(e.target.checked)}
              />
              <span>
                <strong>强制结束</strong>
                <em>进程无响应时勾选；将发送 SIGKILL，进程无法拦截</em>
              </span>
            </label>
          ) : (
            <p className="modal-platform-note">Windows 系统无优雅信号，结束进程一律为强制终止。</p>
          )}

          <div className="modal-warning-text">
            <AlertTriangle size={14} className="warn-icon" />
            <span>结束后该进程占用的端口与连接会立即释放或断开。</span>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" disabled={killing} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={killing}
            onClick={() => onConfirm(effectiveForce)}
          >
            {killing ? <Loader2 className="spin" size={14} /> : null}
            {killing ? '正在结束…' : '确认结束'}
          </button>
        </div>
      </div>
    </div>
  )
}
