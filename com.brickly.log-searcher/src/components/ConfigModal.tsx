import { Check, FolderSearch, PlugZap, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LOG_PATH_PRESETS, type RemoteBrowseResult } from '../domain/paths'
import type { ConnectionTestState, LogFileConfig, ServerConfig } from '../types'
import { RemotePathBrowser } from './RemotePathBrowser'
import { Select } from './ui/select'

const AUTH_OPTIONS = [
  { value: 'password', label: 'SSH 密码' },
  { value: 'key', label: 'SSH 私钥' }
] as const

interface ConfigModalProps {
  server: ServerConfig
  isExisting: boolean
  connectionTest: ConnectionTestState
  onClose: () => void
  onChange: (server: ServerConfig) => void
  onAddLogPath: () => void
  onUpdateLogPath: (index: number, fields: Partial<LogFileConfig>) => void
  onRemoveLogPath: (index: number) => void
  onBrowseRemote: (path: string) => Promise<RemoteBrowseResult>
  onTest: () => void
  onSave: () => void
}

export function ConfigModal({
  server,
  isExisting,
  connectionTest,
  onClose,
  onChange,
  onAddLogPath,
  onUpdateLogPath,
  onRemoveLogPath,
  onBrowseRemote,
  onTest,
  onSave
}: ConfigModalProps) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseIndex, setBrowseIndex] = useState<number | null>(null)

  const openBrowser = (index: number | null) => {
    setBrowseIndex(index)
    setBrowseOpen(true)
  }

  const applyPickedPaths = (paths: string[]) => {
    const cleaned = [...new Set(paths.map(path => path.trim()).filter(Boolean))]
    if (cleaned.length === 0) {
      setBrowseOpen(false)
      return
    }

    let nextLogs = server.logs.map(item => ({ ...item }))
    const existing = new Set(nextLogs.map(item => item.path.trim()).filter(Boolean))
    const insertAt = browseIndex

    cleaned.forEach((path, offset) => {
      if (offset === 0 && insertAt !== null && nextLogs[insertAt]) {
        nextLogs[insertAt] = { ...nextLogs[insertAt], path, enabled: true }
        existing.add(path)
        return
      }
      if (existing.has(path)) return
      const emptyIndex = nextLogs.findIndex(item => item.path.trim() === '')
      if (emptyIndex >= 0) {
        nextLogs[emptyIndex] = { ...nextLogs[emptyIndex], path, enabled: true }
      } else {
        nextLogs = [...nextLogs, { path, enabled: true }]
      }
      existing.add(path)
    })

    onChange({ ...server, logs: nextLogs })
    setBrowseOpen(false)
  }

  const addPreset = (path: string) => {
    const exists = server.logs.some(item => item.path.trim() === path)
    if (exists) return
    const emptyIndex = server.logs.findIndex(item => item.path.trim() === '')
    if (emptyIndex >= 0) {
      onUpdateLogPath(emptyIndex, { path, enabled: true })
      return
    }
    onChange({
      ...server,
      logs: [...server.logs, { path, enabled: true }]
    })
  }

  const browseStartPath = browseIndex !== null
    ? (server.logs[browseIndex]?.path || '/var/log')
    : (server.logs.find(item => item.path.trim())?.path || '/var/log')

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !browseOpen) return
      event.preventDefault()
      event.stopPropagation()
      setBrowseOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [browseOpen])

  return (
    <div className="config-modal-backdrop">
      <div
        className={`config-modal ${browseOpen ? 'config-modal-browse' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-modal-title"
      >
        <div className="config-header">
          <span className="config-title" id="config-modal-title">
            {browseOpen ? '浏览远程日志路径' : (isExisting ? '编辑连接' : '添加连接')}
          </span>
          <button
            className="sidebar-action-btn"
            onClick={() => (browseOpen ? setBrowseOpen(false) : onClose())}
            type="button"
            title={browseOpen ? '返回连接设置' : '关闭'}
          >
            <X size={16} />
          </button>
        </div>

        {browseOpen ? (
          <RemotePathBrowser
            initialPath={browseStartPath}
            onBrowse={onBrowseRemote}
            onPick={applyPickedPaths}
            onClose={() => setBrowseOpen(false)}
          />
        ) : (
        <div className="config-form">
          <div className="form-group">
            <label>连接名称 *</label>
            <input
              type="text"
              value={server.name}
              onChange={(event) => onChange({ ...server, name: event.target.value })}
              placeholder="例如：开发环境 nginx"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>SSH 端口</label>
            <input
              type="number"
              value={server.port || 22}
              onChange={(event) => onChange({ ...server, port: parseInt(event.target.value) || 22 })}
              placeholder="22"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>主机 IP/域名 *</label>
              <input
                type="text"
                value={server.host}
                onChange={(event) => onChange({ ...server, host: event.target.value })}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="form-group">
              <label>SSH 用户名 *</label>
              <input
                type="text"
                value={server.user}
                onChange={(event) => onChange({ ...server, user: event.target.value })}
                placeholder="root"
              />
            </div>
          </div>

          <div className="form-group">
            <label>鉴权方式</label>
            <Select
              ariaLabel="鉴权方式"
              value={server.authType}
              options={AUTH_OPTIONS}
              onChange={(authType) => onChange({ ...server, authType })}
            />
          </div>

          {server.authType === 'password' ? (
            <div className="form-group">
              <label>SSH 密码</label>
              <input
                type="password"
                value={server.password || ''}
                onChange={(event) => onChange({ ...server, password: event.target.value })}
                placeholder="远程登录密码"
              />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>私钥文件物理路径 (优先)</label>
                <input
                  type="text"
                  value={server.keyPath || ''}
                  onChange={(event) => onChange({ ...server, keyPath: event.target.value })}
                  placeholder="C:\Users\username\.ssh\id_rsa"
                />
              </div>
              <div className="form-group">
                <label>私钥文本内容</label>
                <textarea
                  value={server.keyText || ''}
                  onChange={(event) => onChange({ ...server, keyText: event.target.value })}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  spellCheck={false}
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="path-label">
              <span>检索日志路径 ({server.logs.length})</span>
              <span className="path-label-actions">
                <button
                  className="sidebar-action-btn"
                  onClick={() => openBrowser(null)}
                  title="浏览远程目录并添加路径"
                  type="button"
                >
                  <FolderSearch size={12} />
                  浏览远程
                </button>
                <button
                  className="sidebar-action-btn"
                  onClick={onAddLogPath}
                  title="手动添加一条路径"
                  type="button"
                >
                  <Plus size={10} /> 路径
                </button>
              </span>
            </label>
            <p className="path-hint">可手填通配符，或浏览远程目录后点选文件、目录或 *.log。</p>
            <div className="path-presets">
              {LOG_PATH_PRESETS.map(preset => (
                <button key={preset.path} type="button" onClick={() => addPreset(preset.path)}>
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="path-list">
              {server.logs.map((logConf, index) => (
                <div key={index} className="path-item">
                  <input
                    type="checkbox"
                    checked={logConf.enabled}
                    onChange={(event) => onUpdateLogPath(index, { enabled: event.target.checked })}
                  />
                  <input
                    type="text"
                    value={logConf.path}
                    onChange={(event) => onUpdateLogPath(index, { path: event.target.value })}
                    placeholder="/var/log/nginx/*.log"
                    spellCheck={false}
                  />
                  <button
                    className="server-item-btn"
                    onClick={() => openBrowser(index)}
                    title="从远程目录选择"
                    type="button"
                  >
                    <FolderSearch size={12} />
                  </button>
                  <button
                    className="server-item-btn"
                    onClick={() => onRemoveLogPath(index)}
                    title="移除路径"
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

        {!browseOpen && (
        <div className="config-footer">
          {connectionTest.message && (
            <div className={`connection-test-message ${connectionTest.status}`}>
              {connectionTest.message}
            </div>
          )}
          <div className="config-footer-actions">
            <button
              className="btn btn-secondary"
              onClick={onTest}
              disabled={connectionTest.status === 'testing'}
              type="button"
            >
              <PlugZap size={14} />
              {connectionTest.status === 'testing' ? '测试中' : '测试连接'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-primary" onClick={onSave} type="button">
              <Check size={14} />
              保存
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
