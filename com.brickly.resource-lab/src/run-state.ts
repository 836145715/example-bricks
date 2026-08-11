import type { RunSnapshot, StatusCounts, TestResult } from './types'

export function createRunId(windowId = getWindowId()): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${sanitizeId(windowId)}-${random}`.slice(0, 96)
}

export function mergeRunSnapshot(current: RunSnapshot[], incoming: RunSnapshot): RunSnapshot[] {
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
