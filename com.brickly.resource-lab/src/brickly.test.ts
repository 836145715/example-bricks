import assert from 'node:assert/strict'
import test from 'node:test'

import { cancelRun, exportRun, runSuite, subscribeRunUpdates } from './brickly'

test('runSuite 使用可立即返回且可取消的 stream', () => {
  const calls: unknown[][] = []
  let callbacks: Record<string, (...args: any[]) => void> | undefined
  const completed: unknown[] = []
  installWindow({
    invoke: async () => undefined,
    stream: (...args: unknown[]) => {
      calls.push(args)
      callbacks = args[2] as typeof callbacks
      return { cancel: () => calls.push(['cancelled']) }
    }
  })
  const handle = runSuite({ runId: 'window-a-1', mode: 'default' }, (snapshot) => completed.push(snapshot))
  assert.equal(calls[0]?.[0], 'suite-run')
  assert.deepEqual(calls[0]?.[1], { runId: 'window-a-1', mode: 'default' })
  callbacks?.onResult?.({ runId: 'window-a-1', status: 'passed', results: [] })
  assert.equal(completed.length, 1)
  handle.cancel()
  assert.deepEqual(calls.at(-1), ['cancelled'])
})

test('取消只传指定 runId', async () => {
  const calls: unknown[][] = []
  installWindow({ invoke: async (...args: unknown[]) => (calls.push(args), { runId: 'run-b', status: 'cancelled' }) })
  await cancelRun('run-b')
  assert.deepEqual(calls[0], ['suite-cancel', { runId: 'run-b' }])
})

test('事件 payload 使用 ResourceHandle.json 水合运行快照', async () => {
  let handler: ((event: unknown) => void) | undefined
  let closed = false
  const received: unknown[] = []
  installWindow({
    invoke: async () => ({}),
    events: { subscribe: async (_event: string, listener: (event: unknown) => void) => (handler = listener, () => undefined) }
  })
  await subscribeRunUpdates((snapshot) => received.push(snapshot))
  handler?.({ payload: { json: async () => ({ runId: 'run-event', status: 'passed', results: [] }), close: async () => { closed = true } } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(received, [{ runId: 'run-event', status: 'passed', results: [] }])
  assert.equal(closed, true)
})

test('导出读取报告资源文本并关闭和撤销句柄', async () => {
  let closed = false
  let revoked = false
  installWindow({
    invoke: async () => ({ text: async () => '{"ok":true}', close: async () => { closed = true }, revoke: async () => { revoked = true } })
  })
  assert.equal(await exportRun('run-export'), '{"ok":true}')
  assert.equal(closed, true)
  assert.equal(revoked, true)
})

function installWindow(overrides: Record<string, unknown>) {
  Object.assign(globalThis, { window: { brickly: overrides } })
}
