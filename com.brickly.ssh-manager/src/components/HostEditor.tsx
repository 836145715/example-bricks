import { Loader2, PlugZap, Save, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AuthType, HostDraft } from '../types'

export function HostEditor({
  draft,
  mode,
  busy,
  testMessage,
  onChange,
  onSave,
  onTest,
  onDelete,
  onClose
}: {
  draft: HostDraft
  mode: 'create' | 'edit'
  busy: string | null
  testMessage: string
  onChange: (patch: Partial<HostDraft>) => void
  onSave: () => void
  onTest: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <section className="editor-card" role="dialog" aria-labelledby="editor-title" onClick={(event) => event.stopPropagation()}>
        <header className="editor-head">
          <div>
            <h2 id="editor-title">{mode === 'edit' ? draft.name || draft.host || '编辑 Profile' : '新建 Profile'}</h2>
            <p>密码和私钥只保存在本机，不会写入日志。</p>
          </div>
          <button type="button" className="icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="form-grid">
          <Field label="名称">
            <input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="支付核心" />
          </Field>
          <Field label="分组">
            <input value={draft.group} onChange={(event) => onChange({ group: event.target.value })} placeholder="生产" />
          </Field>
          <Field label="主机">
            <input value={draft.host} onChange={(event) => onChange({ host: event.target.value })} placeholder="10.0.0.8" />
          </Field>
          <Field label="端口">
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(event) => onChange({ port: Number(event.target.value) || 22 })}
            />
          </Field>
          <Field label="用户">
            <input value={draft.user} onChange={(event) => onChange({ user: event.target.value })} placeholder="deploy" />
          </Field>
          <Field label="鉴权">
            <select value={draft.authType} onChange={(event) => onChange({ authType: event.target.value as AuthType })}>
              <option value="password">密码</option>
              <option value="key">私钥</option>
            </select>
          </Field>
          {draft.authType === 'password' ? (
            <Field label="密码" wide>
              <input
                type="password"
                autoComplete="off"
                value={draft.password ?? ''}
                onChange={(event) => onChange({ password: event.target.value })}
                placeholder={mode === 'edit' ? '已保存，留空则保持不变' : undefined}
              />
            </Field>
          ) : (
            <>
              <Field label="私钥路径">
                <input
                  value={draft.keyPath ?? ''}
                  onChange={(event) => onChange({ keyPath: event.target.value })}
                  placeholder={mode === 'edit' ? '已保存，留空则保持不变' : 'C:\\Users\\admin\\.ssh\\id_ed25519'}
                />
              </Field>
              <Field label="Passphrase">
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.passphrase ?? ''}
                  onChange={(event) => onChange({ passphrase: event.target.value })}
                  placeholder={mode === 'edit' ? '已保存，留空则保持不变' : undefined}
                />
              </Field>
              <Field label="私钥文本" wide>
                <textarea
                  rows={5}
                  value={draft.keyText ?? ''}
                  onChange={(event) => onChange({ keyText: event.target.value })}
                  placeholder={mode === 'edit' ? '已保存，留空则保持不变' : '也可直接粘贴私钥内容'}
                />
              </Field>
            </>
          )}
          <Field label="标签" wide>
            <input
              value={(draft.tags ?? []).join(', ')}
              onChange={(event) =>
                onChange({
                  tags: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                })
              }
              placeholder="prod, linux"
            />
          </Field>
          <Field label="备注" wide>
            <textarea rows={2} value={draft.note ?? ''} onChange={(event) => onChange({ note: event.target.value })} />
          </Field>
        </div>

        {testMessage ? <p className="editor-message">{testMessage}</p> : null}

        <footer className="editor-actions">
          {mode === 'edit' ? (
            <button type="button" className="ghost-btn danger" disabled={Boolean(busy)} onClick={onDelete}>
              <Trash2 size={14} />
              删除
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={onTest}>
            {busy === 'test' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
            测试
          </button>
          <button type="button" className="primary-btn" disabled={Boolean(busy)} onClick={onSave}>
            {busy === 'save' ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            保存
          </button>
        </footer>
      </section>
    </div>
  )
}

function Field({
  label,
  children,
  wide
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={wide ? 'field field-wide' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  )
}
