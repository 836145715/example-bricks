import { renderAsync } from 'docx-preview'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../lib/format'
import { base64ToUint8Array } from '../../lib/preview'
import type { PreviewResult } from '../../types'
import { TextPreviewBlock } from './TextPreviewBlock'

export function DocumentPreviewBlock({ preview }: { preview: PreviewResult }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [renderState, setRenderState] = useState<'idle' | 'rendering' | 'ready' | 'fallback'>('idle')
  const [renderError, setRenderError] = useState('')
  const documentPackage = preview.document?.package

  useEffect(() => {
    const container = containerRef.current
    if (!container || !documentPackage) {
      setRenderState('fallback')
      return
    }
    let live = true
    container.innerHTML = ''
    setRenderState('rendering')
    setRenderError('')
    const data = base64ToUint8Array(documentPackage)
    void renderAsync(data, container, undefined, {
      className: 'docx-preview-document',
      inWrapper: false,
      ignoreFonts: false,
      ignoreHeight: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true
    })
      .then(() => {
        if (live) setRenderState('ready')
      })
      .catch((error) => {
        if (!live) return
        container.innerHTML = ''
        setRenderState('fallback')
        setRenderError(errorMessage(error))
      })
    return () => {
      live = false
      container.innerHTML = ''
    }
  }, [documentPackage])

  if (!documentPackage || renderState === 'fallback') {
    return (
      <div className="preview-document-fallback">
        {renderError ? <div className="preview-docx-error">DOCX 渲染失败，已切换为正文预览：{renderError}</div> : null}
        <TextPreviewBlock
          content={preview.document?.content || ''}
          encoding={preview.document?.encoding}
          lineCount={preview.document?.lineCount}
          truncated={preview.truncated}
          emptyText="文档中没有提取到可显示正文。"
        />
      </div>
    )
  }

  return (
    <div className="preview-docx-wrap">
      {renderState === 'rendering' ? (
        <div className="preview-docx-loading">
          <Loader2 size={18} className="spin" />
          <span>正在渲染 Word 文档</span>
        </div>
      ) : null}
      <div className="preview-docx-pages" ref={containerRef} />
    </div>
  )
}
