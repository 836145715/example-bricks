import type { StarterConfigField, StarterDraft, StarterEnvVar } from '../types'

interface Props {
  draft: StarterDraft
  onChange: (patch: Partial<StarterDraft>) => void
}

function ConfigFieldsEditor({
  fields,
  onChange
}: {
  fields: StarterConfigField[]
  onChange: (fields: StarterConfigField[]) => void
}) {
  const update = (i: number, patch: Partial<StarterConfigField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div className="kv-editor">
      {fields.map((f, i) => (
        <div key={i} className="kv-row">
          <input
            placeholder="字段名 *"
            value={f.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            placeholder="显示名"
            value={f.label ?? ''}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <select
            value={f.type}
            onChange={(e) => update(i, { type: e.target.value as StarterConfigField['type'] })}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
          </select>
          <input
            placeholder="默认值"
            value={f.default ?? ''}
            onChange={(e) => update(i, { default: e.target.value })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={f.required ?? false}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            必填
          </label>
          <button type="button" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
            删
          </button>
        </div>
      ))}
      <button
        type="button"
        className="add"
        onClick={() => onChange([...fields, { name: '', type: 'string' }])}
      >
        + 添加配置字段
      </button>
    </div>
  )
}

function EnvVarsEditor({
  vars,
  onChange
}: {
  vars: StarterEnvVar[]
  onChange: (vars: StarterEnvVar[]) => void
}) {
  const update = (i: number, patch: Partial<StarterEnvVar>) =>
    onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  return (
    <div className="kv-editor">
      {vars.map((v, i) => (
        <div key={i} className="kv-row">
          <input
            placeholder="变量名 *"
            value={v.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            placeholder="描述"
            value={v.description ?? ''}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <input
            placeholder="默认值"
            value={v.default ?? ''}
            onChange={(e) => update(i, { default: e.target.value })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={v.required ?? false}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            必填
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={v.secret ?? false}
              onChange={(e) => update(i, { secret: e.target.checked })}
            />
            密钥
          </label>
          <button type="button" onClick={() => onChange(vars.filter((_, j) => j !== i))}>
            删
          </button>
        </div>
      ))}
      <button
        type="button"
        className="add"
        onClick={() => onChange([...vars, { name: '' }])}
      >
        + 添加环境变量
      </button>
    </div>
  )
}

export function AdvancedStep({ draft, onChange }: Props) {
  return (
    <div className="step">
      <h2>配置与环境变量</h2>
      <p className="hint">可选。对应 manifest 的 config.fields 与 runtime 环境变量声明。</p>
      <h3>配置字段（Profile fields）</h3>
      <ConfigFieldsEditor
        fields={draft.configFields ?? []}
        onChange={(configFields) => onChange({ configFields })}
      />
      <h3>环境变量</h3>
      <EnvVarsEditor
        vars={draft.envVars ?? []}
        onChange={(envVars) => onChange({ envVars })}
      />
    </div>
  )
}
