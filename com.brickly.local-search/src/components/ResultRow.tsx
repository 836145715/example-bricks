import clsx from 'clsx'
import { Clipboard, ExternalLink, LocateFixed } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatBytes, formatTime, joinPath } from '../lib/format'
import type { SearchItem } from '../types'
import { FileBadge } from './FileBadge'
import { HighlightText } from './HighlightText'

export function ResultRow({
  item,
  active,
  query,
  onSelect,
  onOpen,
  onShowInFolder,
  onCopyPath,
  getIcon
}: {
  item: SearchItem
  active: boolean
  query: string
  onSelect: () => void
  onOpen: () => void
  onShowInFolder: () => void
  onCopyPath: () => void
  getIcon?: (path: string) => Promise<string>
}) {
  const [icon, setIcon] = useState('')
  const fullPath = item.fullPath || joinPath(item)

  useEffect(() => {
    if (!getIcon || !fullPath) return
    let live = true
    getIcon(fullPath)
      .then((value) => {
        if (live) setIcon(value || '')
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [fullPath, getIcon])

  return (
    <li className={clsx('result-row', active && 'result-row-active')} onClick={onSelect}>
      <div className="row-icon">
        {icon ? <img src={icon} alt="" /> : <FileBadge item={item} size={16} />}
      </div>
      <div className="row-main">
        <div className="row-title" title={item.name}>
          <HighlightText text={item.name} highlight={query} />
        </div>
        <div className="row-path" title={fullPath}>
          {fullPath}
        </div>
      </div>
      <div className="row-meta">
        <span>{item.isFolder ? '文件夹' : formatBytes(item.size)}</span>
        <time>{formatTime(item.dateModified, true)}</time>
      </div>
      <div className="row-actions-overlay">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          title="直接打开"
        >
          <ExternalLink size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onShowInFolder()
          }}
          title="在文件夹中定位"
        >
          <LocateFixed size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCopyPath()
          }}
          title="复制文件路径"
        >
          <Clipboard size={12} />
        </button>
      </div>
    </li>
  )
}
