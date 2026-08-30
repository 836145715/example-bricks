import { File } from 'lucide-react'
import { pdfPreviewUrl } from '../../lib/preview'
import type { PreviewResult } from '../../types'
import { ArchivePreviewBlock } from './ArchivePreviewBlock'
import { DocumentPreviewBlock } from './DocumentPreviewBlock'
import { PreviewState } from './PreviewState'
import { SpreadsheetPreviewBlock } from './SpreadsheetPreviewBlock'
import { TextPreviewBlock } from './TextPreviewBlock'

export function PreviewBody({
  preview,
  onOpen,
  onShowInFolder
}: {
  preview: PreviewResult
  onOpen: () => void
  onShowInFolder: () => void
}) {
  switch (preview.kind) {
    case 'text':
      return (
        <TextPreviewBlock
          content={preview.text?.content || ''}
          encoding={preview.text?.encoding}
          lineCount={preview.text?.lineCount}
          truncated={preview.truncated}
        />
      )
    case 'document':
      return <DocumentPreviewBlock preview={preview} />
    case 'spreadsheet':
      return <SpreadsheetPreviewBlock preview={preview} />
    case 'archive':
      return <ArchivePreviewBlock preview={preview} />
    case 'image':
      return (
        <div className="preview-media preview-image">
          {preview.fileUrl ? <img src={preview.fileUrl} alt={preview.name} /> : null}
          {preview.image?.width && preview.image?.height ? (
            <p>
              {preview.image.width} × {preview.image.height}
            </p>
          ) : null}
        </div>
      )
    case 'audio':
      return (
        <div className="preview-media">
          <audio controls preload="metadata" src={preview.fileUrl} />
        </div>
      )
    case 'video':
      return (
        <div className="preview-media">
          <video controls preload="metadata" src={preview.fileUrl} />
        </div>
      )
    case 'pdf':
      return (
        <div className="preview-pdf">
          <iframe src={pdfPreviewUrl(preview.fileUrl)} title={preview.name} />
          <p>如果 PDF 没有显示，请使用打开文件查看。</p>
        </div>
      )
    default:
      return (
        <PreviewState
          icon={<File size={28} />}
          title="暂不支持内嵌预览"
          description={preview.reason || preview.message || '可以使用打开文件或定位目录继续查看。'}
          onOpen={onOpen}
          onShowInFolder={onShowInFolder}
        />
      )
  }
}
