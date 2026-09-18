import { useEffect, useMemo, useState } from 'react'
import { listBricks, listTemplates } from './brickly'
import { AdvancedStep } from './steps/AdvancedStep'
import { BasicsStep } from './steps/BasicsStep'
import { DepsStep } from './steps/DepsStep'
import { ReviewStep } from './steps/ReviewStep'
import { TemplateStep } from './steps/TemplateStep'
import type { DevBrickSummary, StarterDraft, TemplateOptions } from './types'

const STEPS = ['基本信息', '工程模板', '依赖工具', '配置与变量', '预览生成']

export function App() {
  const [step, setStep] = useState(0)
  const [templates, setTemplates] = useState<TemplateOptions | null>(null)
  const [bricks, setBricks] = useState<DevBrickSummary[]>([])
  const [initError, setInitError] = useState<string | null>(null)
  const [draft, setDraft] = useState<StarterDraft>({
    runtime: 'node',
    uiStack: 'react-vite-ts',
    featurePreset: 'full',
    brickId: '',
    name: '',
    authorName: ''
  })

  useEffect(() => {
    void (async () => {
      try {
        const [t, b] = await Promise.all([listTemplates(), listBricks()])
        setTemplates(t)
        setBricks(b)
        setDraft((d) => ({
          ...d,
          runtime: d.runtime || t.defaults.runtime,
          uiStack: d.uiStack || t.defaults.uiStack,
          featurePreset: d.featurePreset || t.defaults.featurePreset,
          version: d.version || t.defaults.version
        }))
      } catch (e) {
        setInitError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const patch = useMemo(
    () => (p: Partial<StarterDraft>) => setDraft((d) => ({ ...d, ...p })),
    []
  )

  if (initError) {
    return (
      <div className="app">
        <div className="error-box">{initError}</div>
      </div>
    )
  }

  return (
    <div className="app">
      <nav className="stepper">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`step-tab ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => setStep(i)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>
      <main className="content">
        {step === 0 && <BasicsStep draft={draft} onChange={patch} />}
        {step === 1 && <TemplateStep draft={draft} templates={templates} onChange={patch} />}
        {step === 2 && <DepsStep draft={draft} bricks={bricks} onChange={patch} />}
        {step === 3 && <AdvancedStep draft={draft} onChange={patch} />}
        {step === 4 && <ReviewStep draft={draft} />}
      </main>
      <footer className="nav-bar">
        <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>
          上一步
        </button>
        <button type="button" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>
          下一步
        </button>
      </footer>
    </div>
  )
}
