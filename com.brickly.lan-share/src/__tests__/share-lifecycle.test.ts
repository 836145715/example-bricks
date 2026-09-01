import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canStartShare,
  LifecycleRequestGate,
  loadShareSnapshot,
  ShareLifecycleStateError,
  startShareLifecycle,
  stopShareLifecycle,
  type ShareLifecycleApi
} from '../share-lifecycle'
import type { ShareStatus } from '../types'

const settings = {
  root: '/srv',
  port: 8723,
  allowUpload: false,
  hasAccessCode: false
}

const input = {
  root: '/srv',
  port: 8723,
  allowUpload: false
}

const runningStatus: ShareStatus = {
  running: true,
  root: '/srv',
  port: 8723,
  allowUpload: false,
  hasAccessCode: false,
  startedAt: 1,
  urls: [],
  log: []
}

const stoppedStatus: ShareStatus = {
  ...runningStatus,
  running: false,
  startedAt: 0,
  urls: []
}

interface FakeOptions {
  runtimeRunning?: boolean
  runtimeStatusError?: Error
  runtimeStartError?: Error
  runtimeStopError?: Error
}

function fakeApi(options: FakeOptions = {}) {
  const calls: string[] = []
  const api: ShareLifecycleApi = {
    async fetchStatus() {
      calls.push('runtime.status')
      if (options.runtimeStatusError) throw options.runtimeStatusError
      return { ...runningStatus, running: options.runtimeRunning ?? false }
    },
    async startShare() {
      calls.push('runtime.start')
      if (options.runtimeStartError) throw options.runtimeStartError
      return runningStatus
    },
    async stopShare() {
      calls.push('runtime.stop')
      if (options.runtimeStopError) throw options.runtimeStopError
      return stoppedStatus
    }
  }
  return { api, calls }
}

test('HTTP 未启动时允许启动共享', () => {
  assert.equal(canStartShare(false), true)
  assert.equal(canStartShare(true), false)
})

test('生命周期操作开始后拒绝在途轮询结果', () => {
  const gate = new LifecycleRequestGate()
  const pollEpoch = gate.capture()

  assert.equal(gate.isCurrent(pollEpoch), true)
  gate.invalidate()
  assert.equal(gate.isCurrent(pollEpoch), false)
  assert.equal(gate.isCurrent(gate.capture()), true)
})

test('初始化直接读取 runtime HTTP 状态', async () => {
  const { api, calls } = fakeApi({ runtimeRunning: true })

  const snapshot = await loadShareSnapshot(api, settings)

  assert.equal(snapshot.status.running, true)
  assert.deepEqual(calls, ['runtime.status'])
})

test('runtime 状态读取失败时携带停止快照', async () => {
  const { api, calls } = fakeApi({
    runtimeStatusError: new Error('runtime disconnected')
  })

  await assert.rejects(
    () => loadShareSnapshot(api, settings),
    (error) => {
      assert.ok(error instanceof ShareLifecycleStateError)
      assert.match(error.message, /runtime disconnected/)
      assert.equal(error.snapshot.status.running, false)
      return true
    }
  )
  assert.deepEqual(calls, ['runtime.status'])
})

test('未共享时启动只调用 runtime.start', async () => {
  const { api, calls } = fakeApi({ runtimeRunning: false })

  const snapshot = await startShareLifecycle(api, input, settings)

  assert.equal(snapshot.status.running, true)
  assert.deepEqual(calls, ['runtime.status', 'runtime.start'])
})

test('HTTP 已运行时不会重复启动', async () => {
  const { api, calls } = fakeApi({ runtimeRunning: true })

  await startShareLifecycle(api, input, settings)

  assert.deepEqual(calls, ['runtime.status'])
})

test('runtime 启动失败不再补偿停止宿主 service', async () => {
  const { api, calls } = fakeApi({
    runtimeRunning: false,
    runtimeStartError: new Error('bind failed')
  })

  await assert.rejects(() => startShareLifecycle(api, input, settings), /bind failed/)
  assert.deepEqual(calls, ['runtime.status', 'runtime.start'])
})

test('停止只关闭 HTTP 文件服务', async () => {
  const { api, calls } = fakeApi({ runtimeRunning: true })

  const result = await stopShareLifecycle(api, settings)

  assert.equal(result.snapshot.status.running, false)
  assert.equal(result.warning, undefined)
  assert.deepEqual(calls, ['runtime.status', 'runtime.stop'])
})

test('已停止时不再调用 runtime.stop', async () => {
  const { api, calls } = fakeApi({ runtimeRunning: false })

  const result = await stopShareLifecycle(api, settings)

  assert.equal(result.snapshot.status.running, false)
  assert.deepEqual(calls, ['runtime.status'])
})

test('runtime stop 失败时保留停止快照错误', async () => {
  const { api, calls } = fakeApi({
    runtimeRunning: true,
    runtimeStopError: new Error('http stop failed')
  })

  await assert.rejects(
    () => stopShareLifecycle(api, settings),
    (error) => {
      assert.ok(error instanceof ShareLifecycleStateError)
      assert.match(error.message, /http stop failed/)
      assert.equal(error.snapshot.status.running, false)
      return true
    }
  )
  assert.deepEqual(calls, ['runtime.status', 'runtime.stop'])
})
