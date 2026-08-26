import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import {
  bindRuntime,
  cancelRun,
  hasRuntime,
  listSuite,
  runSuite,
  subscribeRunUpdates
} from './brickly'
import { createRunId } from './run-state'
import type { RunSnapshot, ScenarioDefinition, SuiteCatalog, TestResult } from './types'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { ScenarioNav } from './components/ScenarioNav'
import { ScenarioGuidePanel } from './components/ScenarioGuide'
import { StatusBar } from './components/StatusBar'

/**
 * 会话内临时状态：关窗再开重新初始化。
 * 不持久化、不保留批次历史；只关心「点某个场景 → 过/不过」。
 */
export default function App() {
  const [catalog, setCatalog] = useState<SuiteCatalog>()
  const [focusId, setFocusId] = useState<string>()
  /** 本会话内各场景最近一次结果（仅内存） */
  const [resultsById, setResultsById] = useState<Record<string, TestResult>>({})
  const [runtimeReady, setRuntimeReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code?: string; message: string; detail?: string }>()
  const activeRunIdRef = useRef<string | undefined>(undefined)
  const sessionRef = useRef<{ cancel(): void } | undefined>(undefined)
  const startedRef = useRef<BricklyStartedHandle | null>(null)

  const applySnapshot = useCallback((snapshot: RunSnapshot) => {
    if (activeRunIdRef.current && snapshot.runId !== activeRunIdRef.current) return
    setResultsById((prev) => {
      const next = { ...prev }
      for (const result of snapshot.results) {
        next[result.scenarioId] = result
      }
      return next
    })
    if (snapshot.status !== 'running') {
      setBusy(false)
      sessionRef.current = undefined
      activeRunIdRef.current = undefined
      const failed = snapshot.results.find((r) => r.status === 'failed' && r.error)
      if (failed?.error) {
        setError({
          code: failed.error.code,
          message: failed.error.message,
          detail: JSON.stringify(failed, null, 2)
        })
      }
    }
  }, [])

  const refreshCatalog = useCallback(async () => {
    const suite = await listSuite()
    setCatalog(suite)
    setFocusId((current) => current ?? suite.scenarios.find((s) => s.mode === 'default')?.id ?? suite.scenarios[0]?.id)
  }, [])

  const connectRuntime = useCallback(async () => {
    if (hasRuntime()) return
    if (!window.brickly?.start) {
      throw new Error('当前不在 Brickly 宿主中，无法连接运行时。')
    }
    const started = await window.brickly.start()
    startedRef.current = started
    bindRuntime(started)
  }, [])

  const initialize = useCallback(async () => {
    setError(undefined)
    setResultsById({})
    setBusy(false)
    activeRunIdRef.current = undefined
    sessionRef.current = undefined
    try {
      await connectRuntime()
      setRuntimeReady(true)
      await refreshCatalog()
    } catch (reason) {
      setRuntimeReady(false)
      setError(toError(reason))
    }
  }, [connectRuntime, refreshCatalog])

  useEffect(() => {
    void initialize()
    return () => {
      bindRuntime(null)
      const started = startedRef.current
      startedRef.current = null
      if (started) void started.dispose()
    }
  }, [initialize])

  useEffect(() => {
    let unsubscribe: (() => void | Promise<void>) | undefined
    void subscribeRunUpdates(applySnapshot)
      .then((next) => {
        unsubscribe = next
      })
      .catch(() => undefined)
    return () => {
      void unsubscribe?.()
    }
  }, [applySnapshot])

  const lastById = useMemo(() => {
    const map = new Map<string, TestResult>()
    for (const [id, result] of Object.entries(resultsById)) map.set(id, result)
    return map
  }, [resultsById])

  const focusScenario = catalog?.scenarios.find((s) => s.id === focusId)
  const focusResult = focusId ? resultsById[focusId] : undefined

  const runScenario = (scenarioId: string) => {
    if (!scenarioId || busy) return
    setError(undefined)
    setFocusId(scenarioId)
    setResultsById((prev) => {
      const next = { ...prev }
      delete next[scenarioId]
      return next
    })
    const runId = createRunId()
    activeRunIdRef.current = runId
    setBusy(true)
    try {
      const session = runSuite(
        { runId, ids: [scenarioId] },
        (snapshot) => applySnapshot(snapshot),
        (reason) => {
          setBusy(false)
          sessionRef.current = undefined
          activeRunIdRef.current = undefined
          if (reason?.code !== 'CANCELLED') {
            setError({
              code: reason?.code,
              message: reason?.message ?? '场景运行失败。'
            })
          }
        }
      )
      sessionRef.current = session
    } catch (reason) {
      setBusy(false)
      activeRunIdRef.current = undefined
      setError(toError(reason))
    }
  }

  const stop = async () => {
    const runId = activeRunIdRef.current
    sessionRef.current?.cancel()
    sessionRef.current = undefined
    if (runId) {
      try {
        applySnapshot(await cancelRun(runId))
      } catch (reason) {
        setBusy(false)
        setError(toError(reason))
      }
    } else {
      setBusy(false)
    }
    activeRunIdRef.current = undefined
  }

  const passed = Object.values(resultsById).filter((r) => r.status === 'passed').length
  const failed = Object.values(resultsById).filter((r) => r.status === 'failed').length

  return (
    <main className="app-shell">
      <TitleBar />
      <Toolbar
        busy={busy}
        hasFocus={Boolean(focusId)}
        runtimeReady={runtimeReady}
        onRunFocused={() => focusId && runScenario(focusId)}
        onStop={() => void stop()}
      />

      {error && (
        <div className="notice error-notice" role="alert">
          <AlertTriangle />
          <div className="notice-body">
            <strong>
              {error.code ? `[${error.code}] ` : ''}
              {error.message}
            </strong>
            {error.detail && (
              <details>
                <summary>详细信息</summary>
                <pre>{error.detail}</pre>
              </details>
            )}
          </div>
          <button type="button" title="重新初始化" onClick={() => void initialize()}>
            <RefreshCw />
          </button>
          <button type="button" className="text-btn" onClick={() => setError(undefined)}>
            关闭
          </button>
        </div>
      )}

      <section className="workspace">
        <ScenarioNav
          scenarios={catalog?.scenarios ?? []}
          focusId={focusId}
          lastById={lastById}
          busy={busy}
          onFocus={setFocusId}
          onRunOne={runScenario}
        />
        <ScenarioGuidePanel
          scenario={focusScenario}
          result={focusResult}
          busy={busy}
          onRun={() => focusId && runScenario(focusId)}
          onRerun={() => focusId && runScenario(focusId)}
        />
      </section>

      <StatusBar
        runtimeReady={runtimeReady}
        busy={busy}
        focusTitle={focusScenario?.title}
        focusStatus={focusResult?.status}
        sessionPassed={passed}
        sessionFailed={failed}
      />
    </main>
  )
}

function toError(reason: unknown): { code?: string; message: string; detail?: string } {
  if (reason && typeof reason === 'object') {
    const err = reason as { code?: string; message?: string; stack?: string }
    return {
      code: err.code,
      message: err.message || 'Resource Lab 操作失败。',
      detail: err.stack
    }
  }
  if (reason instanceof Error) {
    return { message: reason.message, detail: reason.stack }
  }
  return { message: 'Resource Lab 操作失败。' }
}

export function defaultScenarioIds(scenarios: ScenarioDefinition[]): Set<string> {
  return new Set(scenarios.filter((scenario) => scenario.mode === 'default').map((s) => s.id))
}
