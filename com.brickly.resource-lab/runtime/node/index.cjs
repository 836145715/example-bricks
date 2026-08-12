'use strict'

const { randomUUID } = require('node:crypto')
const { statfs } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { BricklyRuntime } = require('@syllm/brickly-sdk')
const { GROUPS, catalog, selectScenarios } = require('./catalog.cjs')
const { RunManager } = require('./run-manager.cjs')
const { createScenarioExecutor } = require('./scenarios.cjs')

const BRICK_ID = 'com.brickly.resource-lab'
const UPDATE_EVENT = 'resource-lab:run-updated'
const brick = new BricklyRuntime({ brickId: BRICK_ID })

const basePorts = {
  resources: brick.resources,
  invokeDetached: (brickId, commandId, value) => brick.invokeRoot(brickId, commandId, value),
  publish: (event, payload) => brick.events.publish(event, payload),
  openForged: async (ref) => {
    // open 校验格式；读流才校验 capability。伪造 token 应在 text() 阶段被拒。
    const handle = brick.resources.open(ref)
    try {
      return await handle.text()
    } finally {
      await handle.close().catch(() => undefined)
    }
  },
  prepareRestart,
  tempDir: tmpdir(),
  freeDiskBytes: async () => {
    const stats = await statfs(tmpdir())
    return Number(stats.bavail) * Number(stats.bsize)
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

const manager = new RunManager({
  executeScenario: createScenarioExecutor(basePorts),
  onUpdate: (snapshot) => brick.events.publish(UPDATE_EVENT, snapshot)
})

brick.onCommand('suite-list', () => ({ groups: GROUPS, scenarios: catalog }))

brick.onCommand('suite-run', async (ctx, input) => {
  const runId = normalizeRunId(input?.runId)
  const mode = input?.mode ?? (Array.isArray(input?.ids) ? 'selected' : 'default')
  const scenarios = selectScenarios(Array.isArray(input?.ids) ? { ids: input.ids } : { mode })
  const ports = {
    ...basePorts,
    invokeRoot: (brickId, commandId, value) => ctx.invoke(brickId, commandId, value),
    invokeRootResource: (brickId, commandId, value) => ctx.invokeResource(brickId, commandId, value)
  }
  manager.start({ runId, mode, scenarios, executeScenario: createScenarioExecutor(ports) })
  ctx.onCancel(() => { void manager.cancel(runId) })
  return manager.wait(runId)
})

brick.onCommand('suite-status', (_ctx, input) => {
  if (typeof input?.runId === 'string' && input.runId) return manager.status(input.runId)
  return { runs: manager.list() }
})

brick.onCommand('suite-cancel', (_ctx, input) => manager.cancel(requireRunId(input)))

brick.onCommand('suite-export', async (_ctx, input) => {
  const snapshot = manager.status(requireRunId(input))
  return brick.resources.create(JSON.stringify({
    schemaVersion: 1,
    exportedAt: Date.now(),
    ...snapshot
  }, null, 2), {
    mimeType: 'application/json',
    name: `resource-lab-${snapshot.runId}.json`
  })
})

brick.onCommand('restart-prepare', async (_ctx, input) => {
  const runId = normalizeRunId(input?.runId)
  const checkpoint = prepareRestart(runId)
  return { status: 'waiting-restart', runId, preparedAt: checkpoint.preparedAt, checkpoint }
})

brick.onCommand('restart-verify', async (_ctx, input) => {
  const checkpoint = input?.checkpoint
  if (!isCheckpoint(checkpoint)) return { status: 'skipped', reason: '没有待验证的重启检查点。' }
  if (checkpoint.pid === process.pid) {
    return { status: 'waiting-restart', runId: checkpoint.runId, preparedAt: checkpoint.preparedAt }
  }
  return {
    status: 'passed',
    runId: checkpoint.runId,
    preparedAt: checkpoint.preparedAt,
    verifiedAt: Date.now(),
    runtimeRecovered: true,
    note: '公开 SDK 仅验证 Runtime 恢复；Host orphan 文件清理由 Host E2E 验证。'
  }
})

brick.onShutdown(async () => {
  await manager.cancelAll()
})
brick.start()

function prepareRestart(runId) {
  return { runId, preparedAt: Date.now(), pid: process.pid, nonce: randomUUID() }
}

function isCheckpoint(value) {
  return Boolean(value && typeof value === 'object' &&
    typeof value.runId === 'string' && typeof value.preparedAt === 'number' &&
    typeof value.pid === 'number' && typeof value.nonce === 'string')
}

function normalizeRunId(value) {
  if (value === undefined || value === null || value === '') return `run-${randomUUID()}`
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value)) {
    const error = new Error('runId 格式无效')
    error.code = 'INVALID_INPUT'
    throw error
  }
  return value
}

function requireRunId(input) {
  if (typeof input?.runId !== 'string' || !input.runId) {
    const error = new Error('runId is required')
    error.code = 'INVALID_INPUT'
    throw error
  }
  return input.runId
}
