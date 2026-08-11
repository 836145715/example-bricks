import assert from 'node:assert/strict'
import test from 'node:test'

import { cancelRun, exportRun, runSuite, subscribeRunUpdates } from './brickly'

test('runSuite 将窗口生成的 runId 传给 Runtime', async () => {
  const calls: unknown[][] = []
  installWindow({ invoke: async (...args: unknown[]) => (calls.push(args), { runId: 'window-a-1', status: 'running' }) })
  await runSuite({ runId: 'window-a-1', mode: 'default' })
  assert.deepEqual(calls[0], ['suite-run', { runId: 'window-a-1', mode: 'default' }])
})

test('取消只传指定 runId', async () => {
  const calls: unknown[][] = []
  installWindow({ invoke: async (...args: unknown[]) => (calls.push(args), { runId: 'run-b', status: 'cancelled' }) })
  await cancelRun('run-b')
  assert.deepEqual(calls[0], ['suite-cancel', { runId: 'run-b' }])
})

test('事件 payload 使用 ResourceHandle.json 水合运行快照', async () => {
  let handler: ((event: unknown) => void) | undefined
  const received: unknown[] = []
  installWindow({
    invoke: async () => ({}),
    events: { subscribe: async (_event: string, listener: (event: unknown) => void) => (handler = listener, () => undefined) }
  })
  await subscribeRunUpdates((snapshot) => received.push(snapshot))
  handler?.({ payload: { json: async () => ({ runId: 'run-event', status: 'passed', results: [] }) } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(received, [{ runId: 'run-event', status: 'passed', results: [] }])
})

test('导出读取报告资源文本并关闭句柄', async () => {
  let closed = false
  installWindow({
    invoke: async () => ({ text: async () => '{"ok":true}', close: async () => { closed = true } })
  })
  assert.equal(await exportRun('run-export'), '{"ok":true}')
  assert.equal(closed, true)
})

function installWindow(overrides: Record<string, unknown>) {
  Object.assign(globalThis, { window: { brickly: overrides } })
}
