import type { RunSnapshot, StatusCounts, TestResult } from './types'

export function createRunId(windowId = getWindowId()): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${sanitizeId(windowId)}-${random}`.slice(0, 96)
}

export function mergeRunSnapshot(current: RunSnapshot[], incoming: unknown): RunSnapshot[] {
  if (!isRunSnapshot(incoming)) return current
  const index = current.findIndex((run) => run.runId === incoming.runId)
  if (index < 0) return [incoming, ...current]
  if (freshness(incoming) < freshness(current[index])) return current
  const next = [...current]
  next[index] = incoming
  return next
}

export function countStatuses(run?: RunSnapshot): StatusCounts {
  const counts: StatusCounts = {
    total: run?.results.length ?? 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    running: 0,
    pending: 0,
    waitingRestart: 0
  }
  for (const result of run?.results ?? []) {
    if (result.status === 'waiting-restart') counts.waitingRestart++
    else counts[result.status]++
  }
  return counts
}

export function resultFreshness(result: TestResult): number {
  return result.finishedAt ?? result.startedAt ?? 0
}

export function isRunSnapshot(value: unknown): value is RunSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const run = value as Partial<RunSnapshot>
  return (
    typeof run.runId === 'string' && run.runId.length > 0 &&
    typeof run.mode === 'string' &&
    typeof run.status === 'string' &&
    typeof run.startedAt === 'number' && Number.isFinite(run.startedAt) &&
    Array.isArray(run.results) && run.results.every(isTestResult)
  )
}

function isTestResult(value: unknown): value is TestResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Partial<TestResult>
  return typeof result.runId === 'string' && typeof result.scenarioId === 'string' &&
    typeof result.status === 'string'
}

function freshness(run: RunSnapshot): number {
  return Math.max(run.finishedAt ?? 0, run.startedAt, ...run.results.map(resultFreshness))
}

function getWindowId(): string {
  const key = 'brickly-resource-lab-window-id'
  try {
    const existing = globalThis.sessionStorage?.getItem(key)
    if (existing) return existing
    const generated = `window-${Math.random().toString(36).slice(2, 10)}`
    globalThis.sessionStorage?.setItem(key, generated)
    return generated
  } catch {
    return 'window'
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'window'
}
