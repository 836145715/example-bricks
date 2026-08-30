import { useMemo } from 'react'

export function TextPreviewBlock({
  content,
  encoding,
  lineCount,
  truncated,
  emptyText = '文件中没有可显示文本。'
}: {
  content: string
  encoding?: string
  lineCount?: number
  truncated?: boolean
  emptyText?: string
}) {
  const lines = useMemo(() => (content ? content.split(/\r?\n/) : []), [content])
  return (
    <div className="preview-text-wrap">
      <div className="preview-text-meta">
        <span>{encoding || 'utf-8'}</span>
        <span>{lineCount || lines.length || 0} 行</span>
        {truncated ? <strong>已截断</strong> : null}
      </div>
      {content ? (
        <div className="preview-text">
          {lines.map((line, i) => (
            <div className="preview-text-line" key={i}>
              <span className="line-num">{i + 1}</span>
              <span className="line-code">{line || ' '}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="preview-empty-line">{emptyText}</p>
      )}
    </div>
  )
}
