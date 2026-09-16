import { AlertTriangle, Camera, FolderOpen, RefreshCw, Square } from 'lucide-react'
import React from 'react'

import { formatBytes } from '../format'
import type { VolumeInfo } from '../types'
import type { ScanStatus } from '../hooks/useDiskMap'

interface VolumeBarProps {
  volume: VolumeInfo | null
  root: string
  status: ScanStatus
  message: string
  scannedFiles: number
  inaccessibleCount: number
  onPickRoot: () => void
  onStopScan: () => void
  onRescan: () => void
}

/** 顶栏：卷用量条 + 根路径 + 选择文件夹 + 扫描状态 + 快照数 + FDA 提示。 */
export const VolumeBar: React.FC<VolumeBarProps> = ({
  volume,
  root,
  status,
  message,
  scannedFiles,
  inaccessibleCount,
  onPickRoot,
  onStopScan,
  onRescan
}) => {
  const total = volume?.totalBytes ?? 0
  const available = volume?.availableBytes ?? 0
  const purgeable = volume?.purgeableBytes ?? 0
  const used = Math.max(0, total - available)
  const usedPct = total > 0 ? (used / total) * 100 : 0
  const purgeablePct = total > 0 ? (purgeable / total) * 100 : 0
  const availPct = total > 0 ? (available / total) * 100 : 100

  return (
    <section className="volume-bar">
      <div className="volume-meter" aria-label="卷用量">
        <div className="volume-segments" title={volume ? `${volume.path}（${volume.device}）` : '读取卷信息中…'}>
          <span className="seg-used" style={{ width: `${usedPct}%` }} />
          <span className="seg-purgeable" style={{ width: `${purgeablePct}%` }} />
          <span className="seg-avail" style={{ width: `${availPct}%` }} />
        </div>
        <div className="volume-legend">
          {volume && (
            <span className="legend-item">
              <i className="dot dot-total" />总容量 {formatBytes(total)}
            </span>
          )}
          <span className="legend-item">
            <i className="dot dot-used" />已用 {formatBytes(used)}
          </span>
          {volume?.purgeableBytes != null && (
            <span className="legend-item">
              <i className="dot dot-purgeable" />可清除 {formatBytes(volume.purgeableBytes)}
            </span>
          )}
          <span className="legend-item">
            <i className="dot dot-avail" />可用 {formatBytes(available)}
          </span>
          {volume && volume.snapshots.length > 0 && (
            <span className="legend-item snap" title={volume.snapshotsError || '本地快照（只读展示，不提供删除）'}>
              <Camera size={11} />
              快照 {volume.snapshots.length}
            </span>
          )}
          {volume?.snapshotsError && (
            <span className="legend-item warn" title={volume.snapshotsError}>
              快照不可用
            </span>
          )}
        </div>
      </div>

      <div className="volume-meta">
        <span className="root-path" title={root}>
          扫描根：{root || '…'}
        </span>
        <button type="button" className="btn" onClick={onPickRoot} title="选择其它目录作为扫描根">
          <FolderOpen size={13} />
          选择文件夹
        </button>
        {status === 'scanning' ? (
          <button type="button" className="btn btn-stop" onClick={onStopScan} title="取消当前扫描">
            <Square size={11} />
            停止
          </button>
        ) : (
          <button type="button" className="btn" onClick={onRescan} title="重新扫描当前根目录">
            <RefreshCw size={13} />
            重新扫描
          </button>
        )}
      </div>

      <div className={`scan-status ${status}`}>
        {status === 'scanning' && <span className="live-dot" aria-hidden />}
        <span className="scan-message" title={message}>
          {message}
          {status === 'scanning' && scannedFiles > 0 ? ` · ${scannedFiles.toLocaleString()} 个文件` : ''}
        </span>
      </div>

      {inaccessibleCount > 0 && (
        <div className="fda-hint" title="部分目录读不到，可在系统设置里给 Brickly 完全磁盘访问">
          <AlertTriangle size={12} />
          {inaccessibleCount} 个目录读不到，可在系统设置里给 Brickly 完全磁盘访问
        </div>
      )}
    </section>
  )
}
