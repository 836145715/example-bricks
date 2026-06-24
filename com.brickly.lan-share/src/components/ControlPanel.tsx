import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, Play, Save, Square } from 'lucide-react'
import { openFolder } from '../brickly'
import type { ShareConfigInput, ShareStatus } from '../types'

interface ControlPanelProps {
  status: ShareStatus
  busy: boolean
  onStart: (config: ShareConfigInput) => void
  onStop: () => void
  onSave: (config: ShareConfigInput) => void
}

/**
 * 共享控制面板：编辑共享目录、端口、上传开关与访问码，并启动/停止服务。
 * 服务运行时锁定配置项，避免与正在运行的实例不一致。
 */
export function ControlPanel({ status, busy, onStart, onStop, onSave }: ControlPanelProps) {
  const [root, setRoot] = useState(status.root)
  const [port, setPort] = useState(String(status.port))
  const [allowUpload, setAllowUpload] = useState(status.allowUpload)
  const [accessCode, setAccessCode] = useState('')
  const [dirty, setDirty] = useState(false)

  // 服务状态变化时（如刚停止）同步回显最新配置，但保留用户正在编辑的访问码。
  useEffect(() => {
    if (dirty) return
    setRoot(status.root)
    setPort(String(status.port))
    setAllowUpload(status.allowUpload)
  }, [status.root, status.port, status.allowUpload, dirty])

  const locked = status.running || busy

  const collectConfig = (): ShareConfigInput => ({
    root: root.trim(),
    port: Number(port) || status.port,
    allowUpload,
    accessCode
  })

  const handleStart = () => {
    onStart(collectConfig())
    setDirty(false)
  }
  const handleSave = () => {
    onSave(collectConfig())
    setDirty(false)
  }

  return (
    <section className="panel control-panel">
      <header className="panel-head">
        <h2>共享设置</h2>
        {status.running && <span className="lock-hint">运行中，停止后可修改</span>}
      </header>

      <label className="field">
        <span className="field-label">共享目录</span>
        <div className="field-row">
          <input
            className="input mono"
            value={root}
            disabled={locked}
            placeholder="选择要共享的目录绝对路径"
            onChange={(event) => {
              setRoot(event.target.value)
              setDirty(true)
            }}
          />
          <button
            type="button"
            className="btn ghost icon-btn"
            title="在文件管理器中打开"
            onClick={() => void openFolder(root.trim() || status.root)}
          >
            <FolderOpen size={16} />
          </button>
        </div>
      </label>

      <div className="field-grid">
        <label className="field">
          <span className="field-label">端口</span>
          <input
            className="input mono"
            type="number"
            min={1}
            max={65535}
            value={port}
            disabled={locked}
            onChange={(event) => {
              setPort(event.target.value)
              setDirty(true)
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">访问码（可选）</span>
          <input
            className="input mono"
            type="text"
            value={accessCode}
            disabled={locked}
            placeholder={status.hasAccessCode ? '已设置，留空保持不变' : '不填则无需鉴权'}
            onChange={(event) => {
              setAccessCode(event.target.value)
              setDirty(true)
            }}
          />
        </label>
      </div>

      <label className="toggle-field">
        <input
          type="checkbox"
          checked={allowUpload}
          disabled={locked}
          onChange={(event) => {
            setAllowUpload(event.target.checked)
            setDirty(true)
          }}
        />
        <span>
          <span className="toggle-title">允许上传</span>
          <span className="toggle-desc">访客可向当前目录上传文件</span>
        </span>
      </label>

      <div className="control-actions">
        {status.running ? (
          <button className="btn danger" onClick={onStop} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Square size={16} />} 停止共享
          </button>
        ) : (
          <button className="btn primary" onClick={handleStart} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Play size={16} />} 启动共享
          </button>
        )}
        <button className="btn ghost" onClick={handleSave} disabled={locked}>
          <Save size={16} /> 保存配置
        </button>
      </div>
    </section>
  )
}
