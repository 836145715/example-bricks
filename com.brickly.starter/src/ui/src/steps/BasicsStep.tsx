import type { StarterDraft } from '../types'

interface Props {
  draft: StarterDraft
  onChange: (patch: Partial<StarterDraft>) => void
}

const BRICK_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/

export function BasicsStep({ draft, onChange }: Props) {
  const idValid = !draft.brickId || BRICK_ID_PATTERN.test(draft.brickId)
  return (
    <div className="step">
      <h2>基本信息</h2>
      <label className="field">
        <span>Brick ID *</span>
        <input
          value={draft.brickId}
          placeholder="com.example.my-tool"
          onChange={(e) => onChange({ brickId: e.target.value.trim() })}
        />
        {!idValid && <em className="error">反向域名格式：小写字母/数字/点/连字符，至少一段点</em>}
      </label>
      <label className="field">
        <span>名称 *</span>
        <input
          value={draft.name}
          placeholder="我的工具"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>作者 *</span>
        <input
          value={draft.authorName}
          placeholder="你的名字或团队"
          onChange={(e) => onChange({ authorName: e.target.value })}
        />
      </label>
      <label className="field">
        <span>描述</span>
        <textarea
          rows={3}
          value={draft.description ?? ''}
          placeholder="一句话说明这个工具做什么"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>版本</span>
          <input
            value={draft.version ?? ''}
            placeholder="0.1.0"
            onChange={(e) => onChange({ version: e.target.value })}
          />
        </label>
        <label className="field">
          <span>关键词（逗号分隔）</span>
          <input
            value={(draft.keywords ?? []).join(', ')}
            placeholder="image, compress"
            onChange={(e) =>
              onChange({
                keywords: e.target.value
                  .split(',')
                  .map((k) => k.trim())
                  .filter(Boolean)
              })
            }
          />
        </label>
      </div>
    </div>
  )
}
