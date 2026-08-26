import assert from 'node:assert/strict'
import test from 'node:test'

import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import {
  bindRuntime,
  cancelRun,
  exportRun,
  listSuite,
  runSuite,
  subscribeRunUpdates
} from './brickly'
import type { RunSnapshot } from './types'

test('runSuite 走已绑定 runtime 的 invoke，取消走 suite-cancel', async () => {
  const completed: RunSnapshot[] = []
  const invokes: unknown[][] = []

  bindRuntime({
    invoke: async (commandId, input) => {
      invokes.push([commandId, input])
      if (commandId === 'suite-cancel') return snapshot({ runId: 'window-a-1', status: 'cancelled' })
      return snapshot({ runId: 'window-a-1', status: 'passed' })
    },
    call: async () => undefined as never,
    interact: async () => ({}) as never,
    dispose: async () => undefined,
    stop: async () => undefined
  } as BricklyStartedHandle)

  const handle = runSuite({ runId: 'window-a-1', mode: 'default' }, (item) => completed.push(item))
  await Promise.resolve()
  handle.cancel()
  await Promise.resolve()
  assert.deepEqual(invokes, [
    ['suite-run', { runId: 'window-a-1', mode: 'default' }],
    ['suite-cancel', { runId: 'window-a-1' }]
  ])
  assert.equal(completed.at(-1)?.status, 'passed')
})

test('未 start 绑定时 runSuite 立即失败', () => {
  bindRuntime(null)
  installWindow({ invoke: async () => undefined })
  assert.throws(() => runSuite({ runId: 'x' }, () => undefined), /尚未就绪|Runtime/)
})

test('listSuite / cancel 走绑定 runtime 的 invoke', async () => {
  const calls: unknown[][] = []
  bindRuntime({
    invoke: async (commandId, input) => {
      calls.push([commandId, input])
      if (commandId === 'suite-list') return { groups: ['create'], scenarios: [] }
      return snapshot({ runId: 'run-b', status: 'cancelled' })
    },
    call: async () => undefined as never,
    interact: async () => ({}) as never,
    dispose: async () => undefined,
    stop: async () => undefined
  } as BricklyStartedHandle)
  assert.deepEqual(await listSuite(), { groups: ['create'], scenarios: [] })
  await cancelRun('run-b')
  assert.deepEqual(calls, [
    ['suite-list', {}],
    ['suite-cancel', { runId: 'run-b' }]
  ])
})

test('事件 payload 使用 ResourceHandle.json 水合运行快照', async () => {
  let handler: ((event: unknown) => void) | undefined
  let closed = false
  const received: unknown[] = []
  installWindow({
    events: {
      subscribe: async (_event: string, listener: (event: unknown) => void) => {
        handler = listener
        return () => undefined
      }
    }
  })
  await subscribeRunUpdates((item) => received.push(item))
  const expected = snapshot({ runId: 'run-event' })
  handler?.({
    payload: {
      json: async () => expected,
      close: async () => {
        closed = true
      }
    }
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(received, [expected])
  assert.equal(closed, true)
})

test('事件资源中的畸形运行快照不会进入订阅回调', async () => {
  let handler: ((event: unknown) => void) | undefined
  let closed = false
  const received: unknown[] = []
  installWindow({
    events: {
      subscribe: async (_event: string, listener: (event: unknown) => void) => {
        handler = listener
        return () => undefined
      }
    }
  })

  await subscribeRunUpdates((item) => received.push(item))
  handler?.({
    payload: {
      json: async () => ({ runId: 'run-event', status: 'running' }),
      close: async () => {
        closed = true
      }
    }
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(received, [])
  assert.equal(closed, true)
})

test('导出通过 resources.open 打开报告 Ref，accessToken 可选', async () => {
  let closed = false
  let revoked = false
  const source = resourceRef('report-export')
  let opened: unknown
  bindRuntime({
    invoke: async () => source,
    call: async () => undefined as never,
    interact: async () => ({}) as never,
    dispose: async () => undefined,
    stop: async () => undefined
  } as BricklyStartedHandle)
  installWindow({
    resources: {
      open: (ref: unknown) => {
        opened = ref
        return {
          text: async () => '{"ok":true}',
          close: async () => {
            closed = true
          },
          revoke: async () => {
            revoked = true
          }
        }
      }
    }
  })
  assert.equal(await exportRun('run-export'), '{"ok":true}')
  assert.deepEqual(opened, source)
  assert.equal(closed, true)
  assert.equal(revoked, true)
})

function installWindow(overrides: Record<string, unknown>) {
  Object.assign(globalThis, { window: { brickly: { ...(globalThis as { window?: { brickly?: object } }).window?.brickly, ...overrides } } })
}

function snapshot(overrides: Record<string, unknown> = {}): RunSnapshot {
  return {
    runId: 'run',
    mode: 'default',
    status: 'passed',
    startedAt: 1,
    results: [],
    ...overrides
  }
}

function resourceRef(resourceId: string) {
  return {
    kind: 'brickly.resource',
    resourceId,
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    expiresAt: Date.now() + 60_000,
    mimeType: 'application/json'
  }
}
