'use strict'

const { randomUUID } = require('node:crypto')
const { readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { BricklyRuntime, ResourceHandle } = require('@syllm/brickly-sdk')
const { GROUPS, catalog, selectScenarios } = require('./catalog.cjs')
const { RunManager } = require('./run-manager.cjs')
const { createScenarioExecutor } = require('./scenarios.cjs')

const BRICK_ID = 'com.brickly.resource-lab'
const UPDATE_EVENT = 'resource-lab:run-updated'
const checkpointPath = join(tmpdir(), 'brickly-resource-lab-restart-checkpoint.json')
const brick = new BricklyRuntime({ brickId: BRICK_ID })
const restartWriters = new Map()

const ports = {
  resources: brick.resources,
  invokeRoot: (brickId, commandId, input) => brick.invokeRoot(brickId, commandId, input),
  invokeRootResource: (brickId, commandId, input) => brick.invokeRootResource(brickId, commandId, input),
  publish: (event, payload) => brick.events.publish(event, payload),
  openForged: async (ref) => new ResourceHandle(brick.transport, ref).text(),
  prepareRestart,
  tempDir: tmpdir(),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

const manager = new RunManager({
  executeScenario: createScenarioExecutor(ports),
  onUpdate: (snapshot) => brick.events.publish(UPDATE_EVENT, snapshot)
})

brick.onCommand('suite-list', () => ({ groups: GROUPS, scenarios: catalog }))

brick.onCommand('suite-run', (_ctx, input) => {
  const runId = normalizeRunId(input?.runId)
  const mode = input?.mode ?? (Array.isArray(input?.ids) ? 'selected' : 'default')
  const scenarios = selectScenarios(Array.isArray(input?.ids) ? { ids: input.ids } : { mode })
  manager.start({ runId, mode, scenarios })
  return { runId, status: 'running' }
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
  return prepareRestart(runId)
})

brick.onCommand('restart-verify', async () => {
  let checkpoint
  try {
    checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'skipped', reason: '没有待验证的重启检查点。' }
    throw error
  }
  if (checkpoint.pid === process.pid) {
    return { status: 'waiting-restart', runId: checkpoint.runId, preparedAt: checkpoint.preparedAt }
  }
  await rm(checkpointPath, { force: true })
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
  await Promise.all([...restartWriters.values()].map((writer) => writer.abort().catch(() => undefined)))
  restartWriters.clear()
})
brick.start()

async function prepareRestart(runId) {
  const writer = await brick.resources.createWriter({
    mimeType: 'application/octet-stream',
    name: 'restart-unfinished.part'
  })
  await writer.write(Buffer.alloc(1024 * 1024, 0x61))
  restartWriters.set(runId, writer)
  const checkpoint = { runId, preparedAt: Date.now(), pid: process.pid }
  await writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf8')
  return { status: 'waiting-restart', runId, preparedAt: checkpoint.preparedAt }
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
