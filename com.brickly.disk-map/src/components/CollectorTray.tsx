import { Archive, Trash2, X } from 'lucide-react'
import React from 'react'

import { formatBytes, shortenPath } from '../format'
import type { TrayItem } from '../hooks/useDiskMap'

interface CollectorTrayProps {
  items: TrayItem[]
  onRemove: (path: string) => void
  onClear: () => void
  onConfirm: () => void
}

/** 底部暂存箱：统一进废纸篓的入口。 */
export const CollectorTray: React.FC<CollectorTrayProps> = ({ items, onRemove, onClear, onConfirm }) => {
  if (items.length === 0) return null
  const total = items.reduce((sum, item) => sum + item.allocatedBytes, 0)

  return (
    <footer className="tray" aria-label="暂存箱">
      <div className="tray-head">
        <Archive size={14} />
        <strong>暂存箱</strong>
        <span className="tray-count">{items.length} 项 · 预计释放 {formatBytes(total)}</span>
        <div className="tray-actions">
          <button type="button" className="btn btn-ghost" onClick={onClear}>
            清空
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            <Trash2 size={13} />
            移入废纸篓
          </button>
        </div>
      </div>
      <ul className="tray-list">
        {items.map((item) => (
          <li key={item.path} className="tray-item">
            <span className="tray-name" title={item.path}>
              {item.name}
            </span>
            <span className="tray-path">{shortenPath(item.path.replace(/^\/Users\/[^/]+/, '~'), 52)}</span>
            <span className="tray-bytes">{formatBytes(item.allocatedBytes)}</span>
            <button type="button" className="icon-btn" title="移出暂存箱" onClick={() => onRemove(item.path)}>
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
    </footer>
  )
}
