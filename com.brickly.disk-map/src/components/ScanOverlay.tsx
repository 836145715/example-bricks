import { FolderOpen, RefreshCw, Search } from 'lucide-react'
import React from 'react'

import { formatBytes } from '../format'

interface ScanOverlayProps {
  visible: boolean
  scannedFiles: number
  scannedBytes: number
  currentPath: string
  message: string
}

/** 图表区扫描叠加层：扫描中显示进度面板，未扫描时显示空状态引导。 */
export const ScanOverlay: React.FC<ScanOverlayProps> = ({
  visible,
  scannedFiles,
  scannedBytes,
  currentPath,
  message
}) => {
  if (!visible) return null

  return (
    <div className="scan-overlay" aria-live="polite">
      <div className="scan-progress">
        <span className="scan-ring" aria-hidden />
        <div className="scan-progress-title">正在扫描磁盘</div>
        <div className="scan-progress-stats">
          <span>{scannedFiles.toLocaleString()} 个文件</span>
          <span>{formatBytes(scannedBytes)}</span>
        </div>
        <div className="scan-progress-path" title={message}>
          {message || currentPath}
        </div>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  visible: boolean
  title: string
  sub: string
  icon: 'folder' | 'refresh'
  actionLabel: string
  onAction: () => void
}

/** 图表区空状态：idle 引导选目录，cancelled / error 引导重扫。 */
export const EmptyState: React.FC<EmptyStateProps> = ({ visible, title, sub, icon, actionLabel, onAction }) => {
  if (!visible) return null

  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        {icon === 'refresh' ? <RefreshCw size={22} /> : <Search size={22} />}
      </span>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-sub">{sub}</div>
      <button type="button" className="btn" onClick={onAction}>
        {icon === 'refresh' ? <RefreshCw size={13} /> : <FolderOpen size={13} />}
        {actionLabel}
      </button>
    </div>
  )
}
