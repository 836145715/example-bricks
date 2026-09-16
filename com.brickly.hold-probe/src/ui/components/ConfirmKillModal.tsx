import { AlertOctagon, AlertTriangle, Loader2, Square, X } from 'lucide-react'
import React, { useEffect } from 'react'
import type { ConfirmTarget } from '../types'

interface ConfirmKillModalProps {
  target: ConfirmTarget
  force: boolean
  loading: boolean
  error: string
  targetPath: string
  onForceChange: (val: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

function baseName(path: string): string {
  if (!path) return '未指定'
  const cleaned = path.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * 赛博暗色确认强杀弹窗 Modal 组件
 */
export const ConfirmKillModal: React.FC<ConfirmKillModalProps> = ({
  target,
  force,
  loading,
  error,
  targetPath,
  onForceChange,
  onCancel,
  onConfirm
}) => {
  // 按 ESC 键快速关闭弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [loading, onCancel])

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !loading && onCancel()}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="确认终止进程"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-head">
          <div className="modal-title-group">
            <span className="modal-icon-badge danger">
              <AlertOctagon size={18} />
            </span>
            <h3>高风险操作：终止进程</h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            title="取消"
            disabled={loading}
            onClick={onCancel}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <div className="modal-target-box">
            <div className="target-row">
              <span className="target-label">目标进程:</span>
              <span className="target-val mono">{target.processName}</span>
            </div>
            <div className="target-row">
              <span className="target-label">PID:</span>
              <span className="target-val mono">{target.pid}</span>
            </div>
            <div className="target-row">
              <span className="target-label">占用目标:</span>
              <span className="target-val" title={targetPath}>
                {baseName(targetPath)}
              </span>
            </div>
            <div className="target-row">
              <span className="target-label">结束模式:</span>
              <span className={`target-val badge ${force ? 'force' : 'normal'}`}>
                {force ? '强制终止' : '正常终止请求'}
              </span>
            </div>
          </div>

          {/* 强制勾选开关 */}
          <label className="modal-force-check">
            <input
              type="checkbox"
              checked={force}
              disabled={loading}
              onChange={(e) => onForceChange(e.target.checked)}
            />
            <span>
              <strong>强制终止进程</strong>
              <em>勾选后将无视进程响应直接强行切断，适合无响应的僵尸进程。</em>
            </span>
          </label>

          {/* 平台提示 */}
          <p className="modal-platform-note">
            终止进程可能释放其持有的文件或目录资源。
          </p>

          {/* 错误提示 */}
          {error ? (
            <div className="modal-warning-text">
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>操作失败: {error}</span>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="modal-foot">
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? (
              <Loader2 className="spin" size={13} />
            ) : (
              <Square size={12} />
            )}
            {loading ? '终止中…' : force ? '强制终止' : '确认终止'}
          </button>
        </div>
      </div>
    </div>
  )
}
