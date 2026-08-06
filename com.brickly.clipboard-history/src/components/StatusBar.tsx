import clsx from 'clsx'
import { RefreshCw, Info } from 'lucide-react'
import React from 'react'
import type { RuntimeStatus, StorageInfo } from '../types'

interface StatusBarProps {
  itemsCount: number
  favoriteCount: number
  statusText: string
  runtimeStatus: RuntimeStatus | null
  storageInfoData: StorageInfo | null
  onSyncNow: () => void
  onOpenDialog: () => void
}

/**
 * 底部状态栏组件：
 * 实时显示监听状态、资源计数、存储路径与操作控制。
 */
export const StatusBar: React.FC<StatusBarProps> = ({
  itemsCount,
  favoriteCount,
  statusText,
  runtimeStatus,
  storageInfoData,
  onSyncNow,
  onOpenDialog
}) => {
  const runtimeDot = runtimeDotClass(runtimeStatus)

  return (
    <footer className="statusbar">
      {/* 左侧状态标识 */}
      <div className="statusbar__left">
        <span className="inline-flex items-center gap-2">
          <span className={runtimeDot} />
          <span className="label">状态</span>
          <span className="val">
            {runtimeStatus?.state === 'running' ? '监听中' : '未就绪'}
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="label">总条目</span>
          <span className="val">{itemsCount}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="label">已收藏</span>
          <span className="val">{favoriteCount}</span>
        </span>
      </div>

      {/* 中间数据库路径提示 */}
      <div className="statusbar__center">
        <span
          className="path cursor-pointer"
          title={statusText + (storageInfoData?.dbPath ? ' · ' + storageInfoData.dbPath : '')}
          onClick={onOpenDialog}
        >
          {storageInfoData?.dbPath ? truncatePath(storageInfoData.dbPath) : statusText}
        </span>
      </div>

      {/* 右侧快捷按钮 */}
      <div className="statusbar__right">
        <button
          type="button"
          className="sb-btn"
          title="立即同步系统剪贴板"
          onClick={onSyncNow}
        >
          <RefreshCw size={12} className="hover:rotate-180 transition-transform duration-500" />
        </button>
        <button
          type="button"
          className="sb-btn"
          title="查看存储与运行时状态"
          onClick={onOpenDialog}
        >
          <Info size={12} />
        </button>
      </div>
    </footer>
  )
}

/* ───────────────────────── 辅助工具函数 ───────────────────────── */

function runtimeDotClass(status?: RuntimeStatus | null): string {
  if (!status) return 'dot dot-off'
  if (status.state === 'error') return 'dot dot-warn'
  if (status.state === 'running') return 'dot'
  return 'dot dot-warn'
}

function truncatePath(p: string): string {
  if (p.length <= 80) return p
  return '…' + p.slice(p.length - 80)
}
