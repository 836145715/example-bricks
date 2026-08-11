import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { cancelRun, exportRun, getRunStatus, listRunStatuses, listSuite, prepareRestart, runSuite, startResourceLab, subscribeRunUpdates, verifyRestart } from './brickly'
import { countStatuses, createRunId, mergeRunSnapshot } from './run-state'
import type { RunSnapshot, ScenarioDefinition, SuiteCatalog, TestResult } from './types'
import { Toolbar } from './components/Toolbar'
import { ScenarioTree } from './components/ScenarioTree'
import { ResultsTable } from './components/ResultsTable'
import { ResultDetails } from './components/ResultDetails'
import { StatusBar } from './components/StatusBar'

const RESTART_CHECKPOINT_KEY = 'brickly.resource-lab.restart-checkpoint'

export default function App() {
  const [catalog, setCatalog] = useState<SuiteCatalog>()
  const [runs, setRuns] = useState<RunSnapshot[]>([])
  const [activeRunId, setActiveRunId] = useState<string>()
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [serviceReady, setServiceReady] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string>()
  const [restartState, setRestartState] = useState<Record<string, unknown>>()
  const activeRunIdRef = useRef(activeRunId)
  const activeRunStreamRef = useRef<{ runId: string; cancel(): void } | undefined>(undefined)
  activeRunIdRef.current = activeRunId

  const merge = useCallback((snapshot: RunSnapshot) => {
    setRuns((current) => mergeRunSnapshot(current, snapshot))
    setActiveRunId((current) => current ?? snapshot.runId)
    const checkpoint = snapshot.results.find((result) => result.status === 'waiting-restart')?.checkpoint
    if (checkpoint && typeof checkpoint === 'object') saveRestartCheckpoint(checkpoint as Record<string, unknown>)
  }, [])

  const initialize = useCallback(async () => {
    setError(undefined)
    try {
      await startResourceLab()
      setServiceReady(true)
      const checkpoint = loadRestartCheckpoint()
      const [suite, history, restart] = await Promise.all([listSuite(), listRunStatuses(), verifyRestart(checkpoint)])
      setCatalog(suite)
      setSelectedIds(new Set(suite.scenarios.filter((item) => item.mode === 'default').map((item) => item.id)))
      setRuns(history.runs)
      setActiveRunId((current) => current ?? history.runs[0]?.runId)
      setRestartState(restart)
      if (restart.status === 'passed') window.localStorage.removeItem(RESTART_CHECKPOINT_KEY)
    } catch (reason) {
      setError(toMessage(reason))
    }
  }, [])

  useEffect(() => { void initialize() }, [initialize])
  useEffect(() => {
    let unsubscribe: (() => void | Promise<void>) | undefined
    void subscribeRunUpdates(merge).then((next) => { unsubscribe = next }).catch((reason) => setError(toMessage(reason)))
    return () => { void unsubscribe?.() }
  }, [merge])
  useEffect(() => {
    const timer = window.setInterval(() => {
      const runId = activeRunIdRef.current
      if (runId) void getRunStatus(runId).then(merge).catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [merge])

  const activeRun = runs.find((run) => run.runId === activeRunId)
  const selectedResult = activeRun?.results.find((result) => result.scenarioId === selectedScenarioId)
  const busy = launching || activeRun?.status === 'running'
  const counts = useMemo(() => countStatuses(activeRun), [activeRun])

  const startRun = (input: { mode?: 'default' | 'stress'; ids?: string[] }) => {
    setError(undefined)
    const runId = createRunId()
    setLaunching(true)
    setActiveRunId(runId)
    setSelectedScenarioId(undefined)
    try {
      const stream = runSuite({ runId, ...input }, (snapshot) => {
        merge(snapshot)
        setLaunching(false)
        if (snapshot.status !== 'running' && activeRunStreamRef.current?.runId === runId) {
          activeRunStreamRef.current = undefined
        }
      }, (reason) => {
        setLaunching(false)
        if (reason?.code !== 'CANCELLED') setError(reason?.message ?? 'Resource Lab 运行失败。')
      })
      activeRunStreamRef.current = { runId, cancel: stream.cancel }
    } catch (reason) {
      setLaunching(false)
      setError(toMessage(reason))
    }
  }
  const runStress = () => {
    if (window.confirm('压力套件会显式执行 201 MiB 和 1 GiB 流式测试，并需要至少 2 GiB 可用磁盘空间。确认继续？')) startRun({ mode: 'stress' })
  }
  const rerun = (result: TestResult) => { startRun({ ids: [result.scenarioId] }) }
  const stop = async () => {
    if (!activeRunId) return
    if (activeRunStreamRef.current?.runId === activeRunId) activeRunStreamRef.current.cancel()
    try { merge(await cancelRun(activeRunId)) } catch (reason) { setError(toMessage(reason)) }
  }
  const exportActive = async () => {
    if (!activeRunId) return
    try {
      const report = await exportRun(activeRunId)
      const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `resource-lab-${activeRunId}.json`; link.click()
      URL.revokeObjectURL(url)
    } catch (reason) { setError(toMessage(reason)) }
  }
  const prepare = async () => {
    const runId = activeRunId ?? createRunId()
    try {
      const restart = await prepareRestart(runId)
      saveRestartCheckpoint(restart.checkpoint)
      setRestartState(restart)
    } catch (reason) { setError(toMessage(reason)) }
  }

  return <main className="app-shell">
    <Toolbar busy={busy} hasRun={Boolean(activeRun)} selectedCount={selectedIds.size}
      onRunDefault={() => startRun({ mode: 'default' })} onRunStress={runStress}
      onRunSelected={() => startRun({ ids: [...selectedIds] })} onStop={() => void stop()}
      onClear={() => { setRuns([]); setActiveRunId(undefined); setSelectedScenarioId(undefined) }} onExport={() => void exportActive()} />
    {error && <div className="notice error-notice"><AlertTriangle /><span>{error}</span><button title="重试连接" onClick={() => void initialize()}><RefreshCw /></button></div>}
    {restartState?.status === 'waiting-restart' && <div className="notice restart-notice"><span>重启检查点已准备。现在重启 Brickly，重新打开后会自动验收 Runtime 恢复。</span></div>}
    {restartState?.status === 'passed' && <div className="notice success-notice"><span>Runtime 重启恢复已通过；Host orphan 清理由 Host E2E 覆盖。</span></div>}
    <nav className="run-tabs" aria-label="运行历史">
      {runs.length === 0 ? <span>运行历史</span> : runs.map((run, index) => <button key={run.runId} className={run.runId === activeRunId ? 'active' : ''} onClick={() => { setActiveRunId(run.runId); setSelectedScenarioId(undefined) }}><i className={`dot dot-${run.status}`} />批次 {runs.length - index}<small>{run.status}</small></button>)}
      <button className="restart-action" onClick={() => void prepare()} disabled={busy}>准备重启验收</button>
    </nav>
    <section className="workspace">
      <ScenarioTree scenarios={catalog?.scenarios ?? []} selected={selectedIds} disabled={!catalog || busy} onChange={setSelectedIds} />
      <ResultsTable results={activeRun?.results ?? []} selectedId={selectedScenarioId} busy={busy} onSelect={(result) => setSelectedScenarioId(result.scenarioId)} onRerun={rerun} />
      <ResultDetails run={activeRun} result={selectedResult} busy={busy} onRerun={rerun} />
    </section>
    <StatusBar run={activeRun} counts={counts} serviceReady={serviceReady} />
  </main>
}

function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : 'Resource Lab 操作失败。' }

function saveRestartCheckpoint(checkpoint: Record<string, unknown>): void {
  window.localStorage.setItem(RESTART_CHECKPOINT_KEY, JSON.stringify(checkpoint))
}

function loadRestartCheckpoint(): Record<string, unknown> | undefined {
  const raw = window.localStorage.getItem(RESTART_CHECKPOINT_KEY)
  if (!raw) return undefined
  try { return JSON.parse(raw) as Record<string, unknown> } catch {
    window.localStorage.removeItem(RESTART_CHECKPOINT_KEY)
    return undefined
  }
}

export function defaultScenarioIds(scenarios: ScenarioDefinition[]): Set<string> {
  return new Set(scenarios.filter((scenario) => scenario.mode === 'default').map((scenario) => scenario.id))
}
