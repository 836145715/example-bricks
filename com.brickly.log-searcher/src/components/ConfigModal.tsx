import { Check, PlugZap, Plus, Trash2, X } from 'lucide-react'
import type { ConnectionTestState, LogFileConfig, ServerConfig } from '../types'

interface ConfigModalProps {
  server: ServerConfig
  isExisting: boolean
  connectionTest: ConnectionTestState
  onClose: () => void
  onChange: (server: ServerConfig) => void
  onAddLogPath: () => void
  onUpdateLogPath: (index: number, fields: Partial<LogFileConfig>) => void
  onRemoveLogPath: (index: number) => void
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
  onTest,
  onSave
}: ConfigModalProps) {
  return (
    <div className="config-modal-backdrop">
      <div
        className="config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-modal-title"
      >
        <div className="config-header">
          <span className="config-title" id="config-modal-title">
            {isExisting ? '编辑连接' : '添加连接'}
          </span>
          <button
            className="sidebar-action-btn"
            onClick={onClose}
            type="button"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

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
            <select
              value={server.authType}
              onChange={(event) => onChange({
                ...server,
                authType: event.target.value as 'password' | 'key'
              })}
            >
              <option value="password">SSH 密码</option>
              <option value="key">SSH 私钥 (Key)</option>
            </select>
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
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>检索日志路径 ({server.logs.length})</span>
              <button
                className="sidebar-action-btn"
                onClick={onAddLogPath}
                title="添加日志路径"
                type="button"
                style={{ padding: '2px 6px', fontSize: '11px', display: 'flex', gap: '3px' }}
              >
                <Plus size={10} /> 路径
              </button>
            </label>

            <div className="path-list">
              {server.logs.map((logConf, index) => (
                <div key={index} className="path-item">
                  <input
                    type="checkbox"
                    checked={logConf.enabled}
                    onChange={(event) => onUpdateLogPath(index, { enabled: event.target.checked })}
                    style={{ accentColor: 'var(--accent-color)', cursor: 'pointer' }}
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
      </div>
    </div>
  )
}
