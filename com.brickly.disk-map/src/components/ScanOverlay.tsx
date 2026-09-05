import { FolderOpen, Search } from 'lucide-react'
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
  onPickRoot: () => void
}

/** 图表区空状态：未扫描时引导选择目录。 */
export const EmptyState: React.FC<EmptyStateProps> = ({ visible, onPickRoot }) => {
  if (!visible) return null

  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Search size={22} />
      </span>
      <div className="empty-state-title">还没有扫描数据</div>
      <div className="empty-state-sub">选择一个目录，地图会实时显示每个文件占用的空间。</div>
      <button type="button" className="btn" onClick={onPickRoot}>
        <FolderOpen size={13} />
        选择文件夹
      </button>
    </div>
  )
}
