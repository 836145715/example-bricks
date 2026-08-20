import { File, Folder } from 'lucide-react'
import { formatBytes } from '../../lib/format'
import type { PreviewResult } from '../../types'

export function ArchivePreviewBlock({ preview }: { preview: PreviewResult }) {
  const entries = preview.archive?.entries || []
  return (
    <div className="preview-list">
      <div className="preview-list-head">
        <span>{preview.archive?.total || 0} 个条目</span>
        {preview.archive?.truncated ? <strong>仅显示前 {entries.length} 项</strong> : null}
      </div>
      {entries.map((entry) => (
        <div className="preview-list-row" key={`${entry.name}:${entry.size}`}>
          <div>
            {entry.isDirectory ? <Folder size={14} /> : <File size={14} />}
            <span title={entry.name}>{entry.name}</span>
          </div>
          <em>{entry.isDirectory ? '目录' : formatBytes(entry.size)}</em>
        </div>
      ))}
    </div>
  )
}
