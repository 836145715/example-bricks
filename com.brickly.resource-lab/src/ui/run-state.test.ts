import assert from 'node:assert/strict'
import test from 'node:test'

import { countStatuses, createRunId, mergeRunSnapshot } from './run-state'
import type { RunSnapshot } from './types'

test('按 runId 合并增量快照并拒绝旧 finishedAt 覆盖新状态', () => {
  const running = snapshot('run-a', 'running', undefined, 'running')
  const passed = snapshot('run-a', 'passed', 20, 'passed')
  const old = snapshot('run-a', 'running', 10, 'running')
  const state = mergeRunSnapshot(mergeRunSnapshot([], running), passed)
  assert.equal(state[0].status, 'passed')
  assert.equal(mergeRunSnapshot(state, old)[0].status, 'passed')
})

test('不同窗口生成的 runId 包含实例前缀且不会冲突', () => {
  const first = createRunId('window-a')
  const second = createRunId('window-b')
  assert.match(first, /^window-a-/)
  assert.match(second, /^window-b-/)
  assert.notEqual(first, second)
})

test('忽略缺少 results 的畸形运行更新', () => {
  const running = snapshot('run-a', 'running', undefined, 'running')
  const malformed = { runId: 'run-a', status: 'running', startedAt: 2 }

  assert.deepEqual(mergeRunSnapshot([], malformed as unknown as RunSnapshot), [])
  assert.deepEqual(
    mergeRunSnapshot([running], malformed as unknown as RunSnapshot),
    [running]
  )
})

test('状态汇总包含全部终态与运行态', () => {
  const counts = countStatuses({
    ...snapshot('run', 'failed', 20, 'passed'),
    results: [
      { ...snapshot('a', 'passed', 1, 'passed').results[0], status: 'passed' },
      { ...snapshot('b', 'failed', 1, 'failed').results[0], status: 'failed' },
      { ...snapshot('c', 'failed', 1, 'skipped').results[0], status: 'skipped' },
      { ...snapshot('d', 'cancelled', 1, 'cancelled').results[0], status: 'cancelled' },
      { ...snapshot('e', 'running', 1, 'running').results[0], status: 'running' }
    ]
  })
  assert.deepEqual(counts, { total: 5, passed: 1, failed: 1, skipped: 1, cancelled: 1, running: 1, pending: 0, waitingRestart: 0 })
})

function snapshot(runId: string, status: RunSnapshot['status'], finishedAt: number | undefined, resultStatus: RunSnapshot['results'][number]['status']): RunSnapshot {
  return {
    runId, mode: 'default', status, startedAt: 1, finishedAt,
    results: [{ runId, scenarioId: 'create-empty', group: 'create', title: '空资源', exclusive: false, status: resultStatus }]
  }
}
