import { useEffect, useMemo, useState } from 'react'
import { listBricks, listTemplates } from './brickly'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  LeafMark,
  MaxIcon,
  MinusIcon,
  RestoreIcon
} from './icons'
import { AdvancedStep } from './steps/AdvancedStep'
import { BasicsStep } from './steps/BasicsStep'
import { DepsStep } from './steps/DepsStep'
import { ReviewStep } from './steps/ReviewStep'
import { TemplateStep } from './steps/TemplateStep'
import type { DevBrickSummary, StarterDraft, TemplateOptions } from './types'

const STEPS = [
  { label: '基本信息', en: 'BASICS' },
  { label: '工程模板', en: 'TEMPLATE' },
  { label: '依赖工具', en: 'DEPENDENCIES' },
  { label: '配置与变量', en: 'CONFIG' },
  { label: '预览生成', en: 'REVIEW' }
] as const

export function App() {
  const [step, setStep] = useState(0)
  const [templates, setTemplates] = useState<TemplateOptions | null>(null)
  const [bricks, setBricks] = useState<DevBrickSummary[]>([])
  const [initError, setInitError] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
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

  const win = typeof window !== 'undefined' ? window.brickly?.window : undefined

  useEffect(() => {
    if (!win) return
    void win.isMaximized().then(setMaximized).catch(() => {})
    return win.onMaximizeChange(setMaximized)
  }, [win])

  const patch = useMemo(
    () => (p: Partial<StarterDraft>) => setDraft((d) => ({ ...d, ...p })),
    []
  )

  if (initError) {
    return (
      <div className="app app-center">
        <div className="error-box">{initError}</div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="tb-brand">
          <span className="brand-mark sm">
            <LeafMark width={13} height={13} />
          </span>
          <strong>脚手架</strong>
          <em>STARTER WIZARD</em>
        </div>
        <div className="tb-title">
          {STEPS[step].label} · STEP 0{step + 1}/0{STEPS.length}
        </div>
        {win && (
          <div className="tb-controls">
            <button type="button" className="tb-btn" title="最小化" onClick={() => void win.minimize()}>
              <MinusIcon width={12} height={12} />
            </button>
            <button
              type="button"
              className="tb-btn"
              title={maximized ? '还原' : '最大化'}
              onClick={() => void win.toggleMaximize().then(setMaximized).catch(() => {})}
            >
              {maximized ? (
                <RestoreIcon width={12} height={12} />
              ) : (
                <MaxIcon width={12} height={12} />
              )}
            </button>
            <button
              type="button"
              className="tb-btn close"
              title="关闭"
              onClick={() => void win.close()}
            >
              <CloseIcon width={12} height={12} />
            </button>
          </div>
        )}
      </header>
      <div className="body">
        <aside className="rail">
          <nav className="stepper">
            {STEPS.map((s, i) => (
              <button
                key={s.label}
                type="button"
                className={`step-node ${i === step ? 'active' : i < step ? 'done' : ''}`}
                onClick={() => setStep(i)}
              >
                <span className="node-dot">
                  {i < step ? <CheckIcon width={11} height={11} /> : `0${i + 1}`}
                </span>
                <span className="node-text">
                  <strong>{s.label}</strong>
                  <em>{s.en}</em>
                </span>
              </button>
            ))}
          </nav>
          <div className="rail-foot">
            <div className="progress-track">
              <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
            <span className="progress-label">
              STEP 0{step + 1} / 0{STEPS.length}
            </span>
          </div>
        </aside>
        <div className="main">
          <main className="content">
            {step === 0 && <BasicsStep draft={draft} onChange={patch} />}
            {step === 1 && <TemplateStep draft={draft} templates={templates} onChange={patch} />}
            {step === 2 && <DepsStep draft={draft} bricks={bricks} onChange={patch} />}
            {step === 3 && <AdvancedStep draft={draft} onChange={patch} />}
            {step === 4 && <ReviewStep draft={draft} />}
          </main>
          <footer className="nav-bar">
            <span className="nav-pos">
              <em>0{step + 1}</em> / 0{STEPS.length} · {STEPS[step].en}
            </span>
            <div className="nav-btns">
              <button
                type="button"
                className="btn ghost"
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeftIcon />
                上一步
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={step === STEPS.length - 1}
                onClick={() => setStep(step + 1)}
              >
                下一步
                <ArrowRightIcon />
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
