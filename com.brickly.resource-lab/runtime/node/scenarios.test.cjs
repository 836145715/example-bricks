const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')

const { catalog } = require('./catalog.cjs')
const { createScenarioExecutor, scenarioHandlers } = require('./scenarios.cjs')

test('每个目录场景都有显式实现', () => {
  assert.deepEqual(
    catalog.filter((scenario) => typeof scenarioHandlers[scenario.id] !== 'function').map((item) => item.id),
    []
  )
})

test('create-text 使用公开 create API 并校验正文与元数据', async () => {
  const calls = []
  const handle = fakeHandle(Buffer.from('resource lab'), 'text/plain; charset=utf-8')
  const execute = createScenarioExecutor(fakePorts({
    resources: {
      create: async (content, options) => (calls.push([content, options]), handle)
    }
  }))
  const result = await execute(catalog.find((item) => item.id === 'create-text'), {
    signal: new AbortController().signal,
    runId: 'run-create'
  })
  assert.equal(calls.length, 1)
  assert.equal(result.sizeBytes, 12)
  assert.equal(result.sha256, createHash('sha256').update('resource lab').digest('hex'))
})

test('invoke-python 将 ResourceHandle 传给目标并校验报告', async () => {
  const handle = fakeHandle(Buffer.from('hello resource'))
  const execute = createScenarioExecutor(fakePorts({
    resources: { create: async () => handle },
    invokeRoot: async (brickId, commandId, input) => {
      assert.equal(brickId, 'com.brickly.resource-echo-python')
      assert.equal(commandId, 'inspect')
      assert.equal(input.resource, handle)
      return {
        runtime: 'python', sizeBytes: 14,
        sha256: createHash('sha256').update('hello resource').digest('hex')
      }
    }
  }))
  const result = await execute(catalog.find((item) => item.id === 'invoke-python'), {
    signal: new AbortController().signal,
    runId: 'run-python'
  })
  assert.equal(result.target, 'python')
  assert.equal(result.sizeBytes, 14)
})

function fakePorts(overrides = {}) {
  return {
    resources: { create: async () => fakeHandle(Buffer.alloc(0)) },
    invokeRoot: async () => ({}),
    invokeRootResource: async () => fakeHandle(Buffer.from('{}'), 'application/json'),
    publish: async () => ({ delivered: 1 }),
    tempDir: process.cwd(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides
  }
}

function fakeHandle(content, mimeType = 'application/octet-stream') {
  return {
    ref: {
      kind: 'brickly.resource', resourceId: 'res_test', accessToken: 'secret',
      sizeBytes: content.byteLength, mimeType,
      sha256: createHash('sha256').update(content).digest('hex')
    },
    async text() { return content.toString('utf8') },
    async json() { return JSON.parse(content.toString('utf8')) },
    async *stream() { yield content },
    async saveTo() {},
    async close() {},
    async revoke() { this.revoked = true }
  }
}
