import type { StarterDraft, TemplateOptions } from '../types'

interface Props {
  draft: StarterDraft
  templates: TemplateOptions | null
  onChange: (patch: Partial<StarterDraft>) => void
}

const RUNTIME_LABELS: Record<string, string> = {
  none: '无 runtime',
  node: 'Node.js',
  python: 'Python',
  go: 'Go'
}

const RUNTIME_DESCS: Record<string, string> = {
  none: '纯 UI 砖，不起后端进程',
  node: '生态最全，默认推荐',
  python: '图像与科学计算见长',
  go: '跨平台单二进制分发'
}

const UI_LABELS: Record<string, string> = {
  none: '无 UI',
  h5: '原生 H5',
  'react-vite-ts': 'React + Vite + TS',
  'vue-vite-ts': 'Vue + Vite + TS'
}

const UI_DESCS: Record<string, string> = {
  none: '平台按 io 自动生成表单',
  h5: '零依赖手写体验窗页面',
  'react-vite-ts': '组件化工程，带类型检查',
  'vue-vite-ts': '组件化工程，带类型检查'
}

const PRESET_LABELS: Record<string, string> = {
  minimal: '最小骨架',
  full: '完整样例',
  window: '窗口工具'
}

const PRESET_DESCS: Record<string, string> = {
  minimal: '只有 manifest 和空 runtime',
  full: '含示例命令与 UI 演示',
  window: '命令式开窗调用样例'
}

function RadioGroup({
  legend,
  options,
  labels,
  descriptions,
  value,
  onSelect
}: {
  legend: string
  options: readonly string[]
  labels: Record<string, string>
  descriptions: Record<string, string>
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
            {descriptions[opt] && <em>{descriptions[opt]}</em>}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function TemplateStep({ draft, templates, onChange }: Props) {
  if (!templates) {
    return (
      <div className="step">
        <div className="loading">
          <span className="spinner" />
          加载模板选项…
        </div>
      </div>
    )
  }
  return (
    <div className="step">
      <header className="step-head">
        <span className="kicker">STEP 02 · TEMPLATE</span>
        <h2>工程模板</h2>
        <p>选运行时、UI 栈与功能预设，create-brickly 按组合生成骨架。</p>
      </header>
      <RadioGroup
        legend="RUNTIME"
        options={templates.runtimes}
        labels={RUNTIME_LABELS}
        descriptions={RUNTIME_DESCS}
        value={draft.runtime}
        onSelect={(runtime) => onChange({ runtime })}
      />
      <RadioGroup
        legend="UI 栈"
        options={templates.uiStacks}
        labels={UI_LABELS}
        descriptions={UI_DESCS}
        value={draft.uiStack}
        onSelect={(uiStack) => onChange({ uiStack })}
      />
      <RadioGroup
        legend="功能预设"
        options={templates.featurePresets}
        labels={PRESET_LABELS}
        descriptions={PRESET_DESCS}
        value={draft.featurePreset}
        onSelect={(featurePreset) => onChange({ featurePreset })}
      />
    </div>
  )
}
