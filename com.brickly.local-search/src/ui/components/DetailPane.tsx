import { Clipboard, ExternalLink, FolderOpen, Loader2, LocateFixed } from 'lucide-react'
import { formatBytes, formatTime } from '../lib/format'
import type { PreviewResult, SearchItem } from '../types'
import { FileBadge } from './FileBadge'
import { PreviewBody } from './preview/PreviewBody'

export function DetailPane({
  selected,
  selectedIcon,
  hasPreview,
  preview,
  previewLoading,
  onOpen,
  onShowInFolder,
  onCopyPath
}: {
  selected: SearchItem | null
  selectedIcon: string
  hasPreview: boolean
  preview: PreviewResult | null
  previewLoading: boolean
  onOpen: () => void
  onShowInFolder: () => void
  onCopyPath: () => void
}) {
  return (
    <aside className="detail-pane" style={hasPreview ? { padding: 0 } : undefined}>
      {selected ? (
        hasPreview && preview ? (
          <div className="preview-content-only">
            <PreviewBody preview={preview} onOpen={onOpen} onShowInFolder={onShowInFolder} />
          </div>
        ) : previewLoading ? (
          <div className="preview-state">
            <Loader2 size={28} className="spin" />
            <h2>正在生成预览</h2>
            <p>只读取受限大小的内容，不会加载完整大文件。</p>
          </div>
        ) : (
          <div className="unsupported-container">
            <div className="unsupported-icon">
              {selectedIcon ? <img src={selectedIcon} alt="" /> : <FileBadge item={selected} size={32} />}
            </div>
            <div className="unsupported-title" title={selected.name}>
              {selected.name}
            </div>
            <div className="unsupported-meta-grid">
              <span className="unsupported-meta-label">大小</span>
              <span className="unsupported-meta-value">
                {selected.isFolder ? '文件夹' : formatBytes(selected.size)}
              </span>
              <span className="unsupported-meta-label">修改时间</span>
              <span className="unsupported-meta-value">{formatTime(selected.dateModified)}</span>
              <span className="unsupported-meta-label">所在路径</span>
              <span className="unsupported-meta-value">{selected.path}</span>
            </div>
            <div className="unsupported-actions">
              <div className="detail-actions">
                <button onClick={onOpen} type="button">
                  <ExternalLink size={16} />
                  打开文件
                </button>
                <button onClick={onShowInFolder} type="button">
                  <LocateFixed size={16} />
                  定位目录
                </button>
                <button onClick={onCopyPath} type="button">
                  <Clipboard size={16} />
                  复制路径
                </button>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="detail-empty">
          <FolderOpen size={26} />
          <h2>选择一个结果</h2>
          <p>文件详情和操作会显示在这里。</p>
        </div>
      )}
    </aside>
  )
}
