import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import {
  cancelRun,
  exportRun,
  getRunStatus,
  listRunStatuses,
  listSuite,
  prepareRestart,
  runSuite,
  startResourceLab,
  subscribeRunUpdates,
  verifyRestart
} from './brickly'
import { countStatuses, createRunId, mergeRunSnapshot } from './run-state'
import type { RunSnapshot, ScenarioDefinition, SuiteCatalog, TestResult } from './types'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { ScenarioNav } from './components/ScenarioNav'
import { ScenarioGuidePanel } from './components/ScenarioGuide'
import { StatusBar } from './components/StatusBar'

const RESTART_CHECKPOINT_KEY = 'brickly.resource-lab.restart-checkpoint'

export default function App() {
  const [catalog, setCatalog] = useState<SuiteCatalog>()
  const [runs, setRuns] = useState<RunSnapshot[]>([])
  const [activeRunId, setActiveRunId] = useState<string>()
  const [focusId, setFocusId] = useState<string>()
  const [serviceReady, setServiceReady] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<{ code?: string; message: string; detail?: string }>()
  const [restartState, setRestartState] = useState<Record<string, unknown>>()
  const activeRunIdRef = useRef(activeRunId)
  const activeRunStreamRef = useRef<{ runId: string; cancel(): void } | undefined>(undefined)
  activeRunIdRef.current = activeRunId

  const merge = useCallback((snapshot: RunSnapshot) => {
    setRuns((current) => mergeRunSnapshot(current, snapshot))
    setActiveRunId((current) => current ?? snapshot.runId)
    const checkpoint = snapshot.results.find((result) => result.status === 'waiting-restart')
      ?.checkpoint
    if (checkpoint && typeof checkpoint === 'object') {
      saveRestartCheckpoint(checkpoint as Record<string, unknown>)
    }
  }, [])

  const initialize = useCallback(async () => {
    setError(undefined)
    try {
      await startResourceLab()
      setServiceReady(true)
      const checkpoint = loadRestartCheckpoint()
      const [suite, history, restart] = await Promise.all([
        listSuite(),
        listRunStatuses(),
        verifyRestart(checkpoint)
      ])
      setCatalog(suite)
      const firstDefault = suite.scenarios.find((s) => s.mode === 'default') ?? suite.scenarios[0]
      setFocusId((current) => current ?? firstDefault?.id)
      setRuns(history.runs)
      setActiveRunId((current) => current ?? history.runs[0]?.runId)
      setRestartState(restart)
      if (restart.status === 'passed') {
        window.localStorage.removeItem(RESTART_CHECKPOINT_KEY)
      }
    } catch (reason) {
      setError(toError(reason))
    }
  }, [])

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    let unsubscribe: (() => void | Promise<void>) | undefined
    void subscribeRunUpdates(merge)
      .then((next) => {
        unsubscribe = next
      })
      .catch((reason) => setError(toError(reason)))
    return () => {
      void unsubscribe?.()
    }
  }, [merge])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const runId = activeRunIdRef.current
      if (runId) void getRunStatus(runId).then(merge).catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [merge])

  const activeRun = runs.find((run) => run.runId === activeRunId)
  const busy = launching || activeRun?.status === 'running'
  const counts = useMemo(() => countStatuses(activeRun), [activeRun])

  /** 各场景最近一次结果（跨历史批次取最新 finished/running） */
  const lastById = useMemo(() => {
    const map = new Map<string, TestResult>()
    for (const run of [...runs].reverse()) {
      for (const result of run.results) {
        const prev = map.get(result.scenarioId)
        if (!prev || resultFreshness(result) >= resultFreshness(prev)) {
          map.set(result.scenarioId, result)
        }
      }
    }
    return map
  }, [runs])

  const focusScenario = catalog?.scenarios.find((s) => s.id === focusId)
  const focusResult = focusId ? lastById.get(focusId) : undefined

  // 当前批次若正在跑 focus 场景，优先显示该批次结果
  const liveFocusResult =
    (focusId && activeRun?.results.find((r) => r.scenarioId === focusId)) || focusResult

  const startRun = (input: { mode?: 'default' | 'stress'; ids?: string[] }) => {
    setError(undefined)
    const runId = createRunId()
    setLaunching(true)
    setActiveRunId(runId)
    if (input.ids?.length === 1) setFocusId(input.ids[0])
    try {
      const stream = runSuite(
        { runId, ...input },
        (snapshot) => {
          merge(snapshot)
          setLaunching(false)
          if (snapshot.status !== 'running' && activeRunStreamRef.current?.runId === runId) {
            activeRunStreamRef.current = undefined
          }
          // 单场景失败时，把错误顶到全局横幅，方便一眼看到
          if (input.ids?.length === 1 && snapshot.status !== 'running') {
            const one = snapshot.results.find((r) => r.scenarioId === input.ids![0])
            if (one?.status === 'failed' && one.error) {
              setError({
                code: one.error.code,
                message: one.error.message,
                detail: JSON.stringify(one, null, 2)
              })
            }
          }
        },
        (reason) => {
          setLaunching(false)
          if (reason?.code !== 'CANCELLED') {
            setError({
              code: reason?.code,
              message: reason?.message ?? 'Resource Lab 运行失败。'
            })
          }
        }
      )
      activeRunStreamRef.current = { runId, cancel: stream.cancel }
    } catch (reason) {
      setLaunching(false)
      setError(toError(reason))
    }
  }

  const runFocused = () => {
    if (!focusId) return
    startRun({ ids: [focusId] })
  }

  const runStress = () => {
    if (
      window.confirm(
        '压力套件会执行 201 MiB / 1 GiB 等流式测试，需要较多时间与磁盘空间。确认继续？'
      )
    ) {
      startRun({ mode: 'stress' })
    }
  }

  const stop = async () => {
    if (!activeRunId) return
    if (activeRunStreamRef.current?.runId === activeRunId) {
      activeRunStreamRef.current.cancel()
    }
    try {
      merge(await cancelRun(activeRunId))
    } catch (reason) {
      setError(toError(reason))
    }
  }

  const exportActive = async () => {
    if (!activeRunId) return
    try {
      const report = await exportRun(activeRunId)
      const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `resource-lab-${activeRunId}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(toError(reason))
    }
  }

  const prepare = async () => {
    const runId = activeRunId ?? createRunId()
    try {
      const restart = await prepareRestart(runId)
      saveRestartCheckpoint(restart.checkpoint)
      setRestartState(restart)
    } catch (reason) {
      setError(toError(reason))
    }
  }

  return (
    <main className="app-shell">
      <TitleBar />
      <Toolbar
        busy={busy}
        hasRun={Boolean(activeRun)}
        hasFocus={Boolean(focusId)}
        serviceReady={serviceReady}
        onRunFocused={runFocused}
        onRunDefault={() => startRun({ mode: 'default' })}
        onRunStress={runStress}
        onStop={() => void stop()}
        onClear={() => {
          setRuns([])
          setActiveRunId(undefined)
          setError(undefined)
        }}
        onExport={() => void exportActive()}
      />

      {error && (
        <div className="notice error-notice" role="alert">
          <AlertTriangle />
          <div className="notice-body">
            <strong>{error.code ? `[${error.code}] ` : ''}{error.message}</strong>
            {error.detail && (
              <details>
                <summary>详细信息</summary>
                <pre>{error.detail}</pre>
              </details>
            )}
          </div>
          <button type="button" title="重试连接" onClick={() => void initialize()}>
            <RefreshCw />
          </button>
          <button type="button" className="text-btn" onClick={() => setError(undefined)}>
            关闭
          </button>
        </div>
      )}

      {restartState?.status === 'waiting-restart' && (
        <div className="notice restart-notice">
          <span>
            重启检查点已准备。请重启 Brickly 并重新打开本工具，将自动验收 Runtime 恢复。
          </span>
        </div>
      )}
      {restartState?.status === 'passed' && (
        <div className="notice success-notice">
          <span>Runtime 重启恢复已通过（Host orphan 清理由 Host E2E 覆盖）。</span>
        </div>
      )}

      <nav className="run-tabs" aria-label="运行历史">
        {runs.length === 0 ? (
          <span className="run-tabs-empty">运行历史为空 · 选一个场景单独跑起来</span>
        ) : (
          runs.map((run, index) => (
            <button
              type="button"
              key={run.runId}
              className={run.runId === activeRunId ? 'active' : ''}
              onClick={() => setActiveRunId(run.runId)}
            >
              <i className={`dot dot-${run.status}`} />
              批次 {runs.length - index}
              <small>{run.status}</small>
            </button>
          ))
        )}
        <button type="button" className="restart-action" onClick={() => void prepare()} disabled={busy}>
          准备重启验收
        </button>
      </nav>

      <section className="workspace">
        <ScenarioNav
          scenarios={catalog?.scenarios ?? []}
          focusId={focusId}
          lastById={lastById}
          busy={busy}
          onFocus={setFocusId}
          onRunOne={(id) => startRun({ ids: [id] })}
        />
        <ScenarioGuidePanel
          scenario={focusScenario}
          result={liveFocusResult}
          busy={busy}
          onRun={runFocused}
          onRerun={runFocused}
        />
      </section>

      <StatusBar
        run={activeRun}
        counts={counts}
        serviceReady={serviceReady}
        focusTitle={focusScenario?.title}
      />
    </main>
  )
}

function resultFreshness(result: TestResult): number {
  return result.finishedAt ?? result.startedAt ?? 0
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

function saveRestartCheckpoint(checkpoint: Record<string, unknown>): void {
  window.localStorage.setItem(RESTART_CHECKPOINT_KEY, JSON.stringify(checkpoint))
}

function loadRestartCheckpoint(): Record<string, unknown> | undefined {
  const raw = window.localStorage.getItem(RESTART_CHECKPOINT_KEY)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    window.localStorage.removeItem(RESTART_CHECKPOINT_KEY)
    return undefined
  }
}

export function defaultScenarioIds(scenarios: ScenarioDefinition[]): Set<string> {
  return new Set(scenarios.filter((scenario) => scenario.mode === 'default').map((s) => s.id))
}
