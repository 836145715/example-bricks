import type { ConfirmState } from '../types'

export function ConfirmDialog({
  confirm,
  onConfirm,
  onCancel
}: {
  confirm: ConfirmState
  onConfirm: () => void
  onCancel: () => void
}) {
  const title = confirm.kind === 'path' ? '上传这个路径？' : '覆盖已存在的文件？'
  const detail =
    confirm.kind === 'path'
      ? confirm.path
      : confirm.remotePath || confirm.localPath || ''
  return (
    <div className="overlay">
      <div className="editor-card confirm-card">
        <h2>{title}</h2>
        <p>{detail}</p>
        {confirm.remoteDir ? <p>远端目录 {confirm.remoteDir}</p> : null}
        <div className="editor-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary-btn" onClick={onConfirm}>
            {confirm.kind === 'overwrite' ? '覆盖' : '上传'}
          </button>
        </div>
      </div>
    </div>
  )
}
