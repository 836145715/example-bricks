import type { StarterDraft, TemplateOptions } from '../types'

interface Props {
  draft: StarterDraft
  templates: TemplateOptions | null
  onChange: (patch: Partial<StarterDraft>) => void
}

const RUNTIME_LABELS: Record<string, string> = {
  none: '无 runtime（纯 UI）',
  node: 'Node.js',
  python: 'Python',
  go: 'Go'
}

const UI_LABELS: Record<string, string> = {
  none: '无 UI',
  h5: '原生 H5',
  'react-vite-ts': 'React + Vite + TS',
  'vue-vite-ts': 'Vue + Vite + TS'
}

const PRESET_LABELS: Record<string, string> = {
  minimal: '最小骨架',
  full: '完整样例',
  window: '窗口工具'
}

function RadioGroup({
  legend,
  options,
  labels,
  value,
  onSelect
}: {
  legend: string
  options: readonly string[]
  labels: Record<string, string>
  value: string
  onSelect: (v: string) => void
}) {
  return (
    <fieldset className="radio-group">
      <legend>{legend}</legend>
      <div className="radio-options">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`radio-card ${value === opt ? 'selected' : ''}`}
            onClick={() => onSelect(opt)}
          >
            <strong>{labels[opt] ?? opt}</strong>
            <code>{opt}</code>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function TemplateStep({ draft, templates, onChange }: Props) {
  if (!templates) return <div className="step">加载模板选项…</div>
  return (
    <div className="step">
      <h2>工程模板</h2>
      <RadioGroup
        legend="Runtime"
        options={templates.runtimes}
        labels={RUNTIME_LABELS}
        value={draft.runtime}
        onSelect={(runtime) => onChange({ runtime })}
      />
      <RadioGroup
        legend="UI 栈"
        options={templates.uiStacks}
        labels={UI_LABELS}
        value={draft.uiStack}
        onSelect={(uiStack) => onChange({ uiStack })}
      />
      <RadioGroup
        legend="功能预设"
        options={templates.featurePresets}
        labels={PRESET_LABELS}
        value={draft.featurePreset}
        onSelect={(featurePreset) => onChange({ featurePreset })}
      />
    </div>
  )
}
