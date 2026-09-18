import { useCallback, useEffect, useState } from 'react'
import { createStarter, previewStarter } from '../brickly'
import { ManifestView } from '../ManifestView'
import type { CreateResult, PreviewResult, StarterDraft } from '../types'

interface Props {
  draft: StarterDraft
}

export function ReviewStep({ draft }: Props) {
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<CreateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setPreview(await previewStarter(draft))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }, [draft])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await createStarter(draft))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="step">
        <h2>创建完成</h2>
        <p>
          已生成 <strong>{result.createdFiles.length}</strong> 个文件到：
        </p>
        <code className="dest">{result.destDir}</code>
        {result.warnings.length > 0 && (
          <ul className="warnings">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <p className="hint">
          开发目录已重扫（当前 {result.rescan.bricks.length} 个工具）。到开发工作台编译运行即可。
        </p>
      </div>
    )
  }

  return (
    <div className="step">
      <h2>预览与生成</h2>
      {error && <div className="error-box">{error}</div>}
      {busy && !preview && <p>生成预览中…</p>}
      {preview && (
        <>
          <div className="preview-grid">
            <div>
              <h3>文件清单（{preview.fileTree.filter((f) => f.kind === 'file').length} 个文件）</h3>
              <ul className="file-tree">
                {preview.fileTree.map((f) => (
                  <li key={f.path} className={f.kind}>
                    {f.path}
                    {f.kind === 'file' && f.bytes !== undefined && (
                      <span className="bytes">{f.bytes}B</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>manifest.json</h3>
              <ManifestView manifest={preview.manifest} />
            </div>
          </div>
          {preview.warnings.length > 0 && (
            <ul className="warnings">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="actions">
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          刷新预览
        </button>
        <button type="button" className="primary" onClick={() => void create()} disabled={busy}>
          生成到开发目录
        </button>
      </div>
    </div>
  )
}
