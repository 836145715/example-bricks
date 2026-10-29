import { useCallback, useEffect, useState } from 'react'
import { createStarter, previewStarter } from '../brickly'
import { ArrowRightIcon, CheckIcon, WarnIcon } from '../icons'
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
        <div className="done-hero">
          <span className="done-check">
            <CheckIcon width={26} height={26} />
          </span>
          <h2>创建完成</h2>
          <p className="hint">
            已生成 <strong>{result.createdFiles.length}</strong> 个文件到：
          </p>
          <code className="dest">{result.destDir}</code>
          {result.warnings.length > 0 && (
            <div className="warnings">
              <WarnIcon />
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="hint">
            开发目录已重扫（当前 {result.rescan.bricks.length} 个工具），到开发工作台编译运行即可。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="step fill">
      <header className="step-head">
        <span className="kicker">STEP 05 · REVIEW</span>
        <h2>预览与生成</h2>
        <p>确认文件清单与 manifest，无误后写入开发目录。</p>
      </header>
      {error && <div className="error-box">{error}</div>}
      {busy && !preview && (
        <div className="loading">
          <span className="spinner" />
          生成预览中…
        </div>
      )}
      {preview && (
        <>
          <div className="preview-grid">
            <section className="card">
              <header className="card-head">
                <span>文件清单</span>
                <em>{preview.fileTree.filter((f) => f.kind === 'file').length} 个文件</em>
              </header>
              <ul className="file-tree">
                {preview.fileTree.map((f) => (
                  <li
                    key={f.path}
                    className={f.kind}
                    style={{ paddingLeft: 4 + (f.path.split('/').length - 1) * 14 }}
                  >
                    <span className="path">{f.path}</span>
                    {f.kind === 'file' && f.bytes !== undefined && (
                      <span className="bytes">{f.bytes}B</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <header className="card-head">
                <span>manifest.json</span>
                <em>SCHEMA VALIDATED</em>
              </header>
              <ManifestView manifest={preview.manifest} />
            </section>
          </div>
          {preview.warnings.length > 0 && (
            <div className="warnings">
              <WarnIcon />
              <ul>
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="actions">
        <button type="button" className="btn ghost" onClick={() => void refresh()} disabled={busy}>
          刷新预览
        </button>
        <button type="button" className="btn primary" onClick={() => void create()} disabled={busy}>
          生成到开发目录
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  )
}
