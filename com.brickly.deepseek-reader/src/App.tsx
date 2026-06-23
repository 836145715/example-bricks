import { useCallback, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  FolderOpen,
  Loader2,
  X
} from 'lucide-react'
import { invokePlugin, pickExportDirectory } from './lib/bridge'
import type { SaveResult } from './types'

export default function App(): React.JSX.Element {
  const [shareInput, setShareInput] = useState('')
  const [includeThinking, setIncludeThinking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SaveResult | null>(null)
  const [copied, setCopied] = useState(false)

  const canExport = useMemo(() => shareInput.trim().length > 0, [shareInput])

  const exportMarkdown = useCallback(async () => {
    if (!canExport) {
      setError('请输入 DeepSeek 分享链接或 ID')
      return
    }

    setError('')
    setResult(null)

    setLoading(true)
    try {
      const saveDir = await pickExportDirectory()
      if (!saveDir) return

      const saved = await invokePlugin<SaveResult>('save', {
        shareId: shareInput.trim(),
        saveDir,
        includeThinking,
        timeout: 30
      })
      setResult(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [canExport, includeThinking, shareInput])

  const copyPath = useCallback(() => {
    if (!result?.savedTo) return
    void navigator.clipboard?.writeText(result.savedTo)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [result])

  const handleReset = useCallback(() => {
    setResult(null)
    setShareInput('')
    setError('')
  }, [])

  // 自适应样式控制
  const panelClasses = useMemo(() => {
    return [
      'tool-panel',
      error ? 'has-error' : '',
      result ? 'has-result' : ''
    ].filter(Boolean).join(' ')
  }, [error, result])

  return (
    <main className="app-shell">
      <section className={panelClasses} aria-label="DeepSeek Markdown 导出">
        <header className="tool-header">
          <div>
            <h1>DeepSeek 导出</h1>
            <p>分享链接保存为 Markdown。</p>
          </div>
          <span className="status-dot" aria-label="就绪" />
        </header>

        {/* 表单输入与复选框组合包裹（支持成功后平滑收缩） */}
        <div className="input-group-wrapper">
          <label className="field">
            <span>分享链接或 ID</span>
            <input
              value={shareInput}
              onChange={(event) => setShareInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void exportMarkdown()
              }}
              placeholder="https://chat.deepseek.com/share/..."
              autoFocus
              disabled={loading}
            />
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={includeThinking}
              onChange={(event) => setIncludeThinking(event.target.checked)}
              disabled={loading}
            />
            <span>包含思考过程</span>
          </label>
        </div>

        <button
          type="button"
          className={`primary-action ${loading ? 'is-loading' : ''}`}
          disabled={loading || !canExport}
          onClick={() => void exportMarkdown()}
        >
          {loading ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />}
          {loading ? '正在导出...' : '选择目录并导出'}
        </button>

        {error && (
          <div className="notice error">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="关闭错误">
              <X size={14} />
            </button>
          </div>
        )}

        {result && (
          <div className="result-box">
            <div className="result-title">
              <CheckCircle2 size={15} />
              <span>已成功导出 Markdown</span>
            </div>
            
            <div className="result-info-row">
              <p className="result-filename" title={result.title}>{result.title}</p>
              <div className="result-meta">
                <span>{result.messageCount} 消息</span>
                {result.bytes > 0 && <span>{formatBytes(result.bytes)}</span>}
              </div>
            </div>

            <button 
              type="button" 
              className={`path-button ${copied ? 'copied' : ''}`} 
              onClick={copyPath}
              title="点击复制完整路径"
            >
              <Clipboard size={13} />
              <span>{copied ? '✓ 已成功复制文件路径！' : result.savedTo}</span>
            </button>
            <button 
              type="button" 
              className="secondary-action" 
              onClick={handleReset}
            >
              继续导出新链接
            </button>
          </div>
        )}

        <footer className="tool-footer">
          <Download size={13} />
          <span>导出时选择保存目录，文件名自动生成</span>
        </footer>
      </section>
    </main>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

