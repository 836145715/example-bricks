import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react'
import React, { useEffect } from 'react'

interface ConfirmKillModalProps {
  open: boolean
  pid: number | null
  processName?: string | null
  forceKill: boolean
  killing: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 自定义赛博暗黑风格结束进程确认弹窗
 */
export const ConfirmKillModal: React.FC<ConfirmKillModalProps> = ({
  open,
  pid,
  processName,
  forceKill,
  killing,
  onConfirm,
  onCancel
}) => {
  // 按 Esc 自动关闭弹窗
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !killing) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, killing, onCancel])

  if (!open || pid === null) return null

  const label = processName ? `${processName}` : `PID ${pid}`

  return (
    <div className="modal-overlay" onClick={killing ? undefined : onCancel}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        {/* 头部 */}
        <div className="modal-head">
          <div className="modal-title-group">
            <span className="modal-icon-badge danger">
              <ShieldAlert size={18} />
            </span>
            <h3 id="confirm-modal-title">确定终止此进程？</h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            disabled={killing}
            onClick={onCancel}
            title="取消"
          >
            <X size={14} />
          </button>
        </div>

        {/* 内容 */}
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
              <span className="target-label">模式策略</span>
              <span className={`target-val badge ${forceKill ? 'force' : 'normal'}`}>
                {forceKill ? '强制强杀 (Force Kill)' : '标准终止 (SIGTERM)'}
              </span>
            </div>
          </div>

          <div className="modal-warning-text">
            <AlertTriangle size={14} className="warn-icon" />
            <span>结束该进程后，占用当前端口的所有套接字连接将立即被切断。</span>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={killing}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={killing}
            onClick={onConfirm}
          >
            {killing ? <Loader2 className="spin" size={14} /> : null}
            {killing ? '正在终止...' : '确认强杀进程'}
          </button>
        </div>
      </div>
    </div>
  )
}
