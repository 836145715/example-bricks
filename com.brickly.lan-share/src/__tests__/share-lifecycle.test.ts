import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canStartShare,
  isServiceActive,
  isServiceTransitioning,
  LifecycleRequestGate,
  loadShareSnapshot,
  ShareLifecycleStateError,
  startShareLifecycle,
  stopShareLifecycle,
  type ShareLifecycleApi
} from '../share-lifecycle'
import type { BrickServiceStatus, ShareStatus } from '../types'

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

interface FakeOptions {
  service: BrickServiceStatus
  runtimeRunning?: boolean
  runtimeStatusError?: Error
  serviceAfterRuntimeStatusError?: BrickServiceStatus
  runtimeStartError?: Error
  runtimeStopError?: Error
  serviceStopError?: Error
}

function fakeApi(options: FakeOptions) {
  const calls: string[] = []
  let serviceStatus = options.service
  let runtimeStatusFailed = false
  const api: ShareLifecycleApi = {
    async getServiceStatus() {
      calls.push('service.getStatus')
      if (runtimeStatusFailed && options.serviceAfterRuntimeStatusError) {
        serviceStatus = options.serviceAfterRuntimeStatusError
      }
      return { brickId: 'com.brickly.lan-share', status: serviceStatus }
    },
    async startService() {
      calls.push('service.start')
      serviceStatus = 'running'
    },
    async stopService() {
      calls.push('service.stop')
      if (options.serviceStopError) throw options.serviceStopError
      serviceStatus = 'stopped'
    },
    async fetchStatus() {
      calls.push('runtime.status')
      if (options.runtimeStatusError) {
        runtimeStatusFailed = true
        throw options.runtimeStatusError
      }
      return { ...runningStatus, running: options.runtimeRunning ?? true }
    },
    async startShare() {
      calls.push('runtime.start')
      if (options.runtimeStartError) throw options.runtimeStartError
      return runningStatus
    },
    async stopShare() {
      calls.push('runtime.stop')
      if (options.runtimeStopError) throw options.runtimeStopError
      return { ...runningStatus, running: false, startedAt: 0, urls: [] }
    }
  }
  return { api, calls }
}

test('UI 将运行和过渡中的宿主状态视为服务活跃', () => {
  for (const status of ['running', 'starting', 'restarting', 'stopping'] as const) {
    assert.equal(isServiceActive(status), true, status)
  }
  for (const status of ['stopped', 'crashed', 'error'] as const) {
    assert.equal(isServiceActive(status), false, status)
  }
})

test('UI 仅在宿主过渡状态持续快速轮询', () => {
  for (const status of ['starting', 'restarting', 'stopping'] as const) {
    assert.equal(isServiceTransitioning(status), true, status)
  }
  assert.equal(isServiceTransitioning('running'), false)
  assert.equal(isServiceTransitioning('stopped'), false)
})

test('宿主运行但 HTTP 未启动时仍允许启动共享', () => {
  assert.equal(canStartShare('running', false), true)
  assert.equal(canStartShare('stopped', false), true)
  assert.equal(canStartShare('running', true), false)
  assert.equal(canStartShare('starting', false), false)
  assert.equal(canStartShare('stopping', false), false)
})

test('生命周期操作开始后拒绝在途轮询结果', () => {
  const gate = new LifecycleRequestGate()
  const pollEpoch = gate.capture()

  assert.equal(gate.isCurrent(pollEpoch), true)
  gate.invalidate()
  assert.equal(gate.isCurrent(pollEpoch), false)
  assert.equal(gate.isCurrent(gate.capture()), true)
})

test('停止状态初始化不会唤起 runtime', async () => {
  const { api, calls } = fakeApi({ service: 'stopped' })

  const snapshot = await loadShareSnapshot(api, settings)

  assert.equal(snapshot.service.status, 'stopped')
  assert.equal(snapshot.status.running, false)
  assert.deepEqual(calls, ['service.getStatus'])
})

test('运行状态初始化在宿主确认后读取 runtime', async () => {
  const { api, calls } = fakeApi({ service: 'running' })

  const snapshot = await loadShareSnapshot(api, settings)

  assert.equal(snapshot.status.running, true)
  assert.deepEqual(calls, ['service.getStatus', 'runtime.status'])
})

test('启动严格先启动并确认宿主 service 再启动 runtime', async () => {
  const { api, calls } = fakeApi({ service: 'stopped' })

  const snapshot = await startShareLifecycle(api, input, settings)

  assert.equal(snapshot.status.running, true)
  assert.deepEqual(calls, [
    'service.getStatus',
    'service.start',
    'service.getStatus',
    'runtime.start'
  ])
})

test('宿主和 runtime 已运行时不会重复启动', async () => {
  const { api, calls } = fakeApi({ service: 'running' })

  await startShareLifecycle(api, input, settings)

  assert.deepEqual(calls, ['service.getStatus', 'runtime.status'])
})

test('runtime 启动失败会补偿停止刚启动的 service', async () => {
  const { api, calls } = fakeApi({
    service: 'stopped',
    runtimeStartError: new Error('bind failed')
  })

  await assert.rejects(() => startShareLifecycle(api, input, settings), /bind failed/)
  assert.deepEqual(calls, [
    'service.getStatus',
    'service.start',
    'service.getStatus',
    'runtime.start',
    'service.stop'
  ])
})

test('补偿停止失败时携带复查后的宿主运行快照', async () => {
  const { api, calls } = fakeApi({
    service: 'stopped',
    runtimeStartError: new Error('bind failed'),
    serviceStopError: new Error('cleanup failed')
  })

  await assert.rejects(
    () => startShareLifecycle(api, input, settings),
    (error) => {
      assert.ok(error instanceof ShareLifecycleStateError)
      assert.match(error.message, /bind failed/)
      assert.match(error.message, /cleanup failed/)
      assert.equal(error.snapshot.service.status, 'running')
      assert.equal(error.snapshot.status.running, false)
      return true
    }
  )
  assert.deepEqual(calls, [
    'service.getStatus',
    'service.start',
    'service.getStatus',
    'runtime.start',
    'service.stop',
    'service.getStatus'
  ])
})

test('接入其他窗口正在启动的 service 时不拥有失败补偿权', async () => {
  const { api, calls } = fakeApi({
    service: 'starting',
    runtimeStartError: new Error('bind failed')
  })

  await assert.rejects(() => startShareLifecycle(api, input, settings), /bind failed/)
  assert.deepEqual(calls, [
    'service.getStatus',
    'service.start',
    'service.getStatus',
    'runtime.start'
  ])
})

test('停止严格先关闭 runtime 再关闭并确认宿主 service', async () => {
  const { api, calls } = fakeApi({ service: 'running' })

  const result = await stopShareLifecycle(api, settings)

  assert.equal(result.snapshot.service.status, 'stopped')
  assert.equal(result.warning, undefined)
  assert.deepEqual(calls, [
    'service.getStatus',
    'runtime.stop',
    'service.stop',
    'service.getStatus'
  ])
})

test('runtime stop 失败仍停止宿主 service', async () => {
  const { api, calls } = fakeApi({
    service: 'running',
    runtimeStopError: new Error('http stop failed')
  })

  const result = await stopShareLifecycle(api, settings)

  assert.equal(result.snapshot.service.status, 'stopped')
  assert.match(result.warning ?? '', /http stop failed/)
  assert.deepEqual(calls, [
    'service.getStatus',
    'runtime.stop',
    'service.stop',
    'service.getStatus'
  ])
})

test('宿主停止失败且仍 running 时不得返回已停止', async () => {
  const { api, calls } = fakeApi({
    service: 'running',
    serviceStopError: new Error('host stop failed')
  })

  await assert.rejects(
    () => stopShareLifecycle(api, settings),
    (error) => {
      assert.ok(error instanceof ShareLifecycleStateError)
      assert.match(error.message, /host stop failed/)
      assert.equal(error.snapshot.service.status, 'running')
      assert.equal(error.snapshot.status.running, false)
      return true
    }
  )
  assert.deepEqual(calls, [
    'service.getStatus',
    'runtime.stop',
    'service.stop',
    'service.getStatus'
  ])
})

test('runtime 状态读取失败后宿主已停止则返回停止态', async () => {
  const { api, calls } = fakeApi({
    service: 'running',
    runtimeStatusError: new Error('runtime disconnected'),
    serviceAfterRuntimeStatusError: 'stopped'
  })

  const snapshot = await loadShareSnapshot(api, settings)

  assert.equal(snapshot.service.status, 'stopped')
  assert.equal(snapshot.status.running, false)
  assert.deepEqual(calls, ['service.getStatus', 'runtime.status', 'service.getStatus'])
})

test('runtime 状态读取失败且宿主仍运行时保留原错误', async () => {
  const { api } = fakeApi({
    service: 'running',
    runtimeStatusError: new Error('runtime disconnected')
  })

  await assert.rejects(
    () => loadShareSnapshot(api, settings),
    (error) => {
      assert.ok(error instanceof ShareLifecycleStateError)
      assert.match(error.message, /runtime disconnected/)
      assert.equal(error.snapshot.service.status, 'running')
      assert.equal(error.snapshot.status.running, false)
      return true
    }
  )
})
