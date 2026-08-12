const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const ENTRY = path.join(__dirname, 'index.cjs')

test('Runtime 注册完整命令并以 runId 隔离运行、查询、导出和取消', async (t) => {
  const harness = loadRuntime(t)
  assert.deepEqual([...harness.commands.keys()].sort(), [
    'restart-prepare', 'restart-verify', 'suite-cancel', 'suite-export',
    'suite-list', 'suite-run', 'suite-status'
  ])

  const listed = await harness.commands.get('suite-list')({}, {})
  assert.ok(listed.scenarios.length >= 25)
  assert.equal(listed.groups.length, 5)

  const completed = await harness.commands.get('suite-run')({ onCancel() {} }, {
    runId: 'window-a-run-1', ids: ['create-empty']
  })
  assert.equal(completed.runId, 'window-a-run-1')
  assert.equal(completed.status, 'passed')

  const exported = await harness.commands.get('suite-export')({}, { runId: completed.runId })
  assert.equal(exported.fakeResource, true)
  assert.match(exported.content, /window-a-run-1/)
  assert.equal(exported.content.includes('accessToken'), false)

  const runningPromise = harness.commands.get('suite-run')({ onCancel() {} }, {
    runId: 'window-b-run-1', ids: ['resource-ttl']
  })
  await waitUntil(async () => (await harness.commands.get('suite-status')({}, { runId: 'window-b-run-1' })).status === 'running')
  const cancelled = await harness.commands.get('suite-cancel')({}, { runId: 'window-b-run-1' })
  assert.equal(cancelled.runId, 'window-b-run-1')
  assert.equal(cancelled.status, 'cancelled')
  assert.equal((await runningPromise).status, 'cancelled')
  assert.ok(harness.published.some((event) => event.event === 'resource-lab:run-updated'))

  const restart = await harness.commands.get('restart-prepare')({}, { runId: 'restart-run' })
  assert.equal(restart.status, 'waiting-restart')
  assert.equal(typeof restart.checkpoint.nonce, 'string')
  assert.equal((await harness.commands.get('restart-verify')({}, { checkpoint: restart.checkpoint })).status, 'waiting-restart')
  const recovered = await harness.commands.get('restart-verify')({}, {
    checkpoint: { ...restart.checkpoint, pid: restart.checkpoint.pid + 1 }
  })
  assert.equal(recovered.status, 'passed')
})

test('manifest 不声明资源权限且依赖三种 Echo Brick', () => {
  const manifest = require(path.join(__dirname, '..', '..', 'manifest.json'))
  assert.equal(manifest.permissions.some((permission) => permission.startsWith('resource.')), false)
  assert.ok(manifest.permissions.includes('event.publish:resource-lab:probe'))
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    'com.brickly.resource-echo-go',
    'com.brickly.resource-echo-node',
    'com.brickly.resource-echo-python'
  ])
  assert.equal(manifest.ui.type, 'webview')
  assert.equal(manifest.lifecycle?.state, 'stateful')
  assert.equal(manifest.lifecycle?.service, undefined)
  for (const brickId of Object.keys(manifest.dependencies)) {
    const echoManifest = require(path.join(__dirname, '..', '..', '..', brickId, 'manifest.json'))
    assert.ok(echoManifest.subscriptions.some((item) => item.event === 'resource-lab:probe'))
    assert.ok(echoManifest.triggers.some((item) => item.type === 'event' && item.event === 'resource-lab:probe'))
  }
})

function loadRuntime(t) {
  const commands = new Map()
  const published = []
  let instance

  class FakeResourceHandle {
    constructor(_transport, ref) { this.ref = ref }
    async text() {
      const error = new Error('forged')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  class FakeRuntime {
    constructor() {
      instance = this
      this.transport = {}
      this.resources = {
        open: (ref) => new FakeResourceHandle(this.transport, ref),
        create: async (content) => fakeHandle(Buffer.from(content)),
        createFrom: async (source) => {
          const chunks = []
          for await (const chunk of source) chunks.push(Buffer.from(chunk))
          return fakeHandle(Buffer.concat(chunks))
        },
        createWriter: async () => fakeWriter()
      }
      this.events = {
        publish: async (event, payload) => (published.push({ event, payload }), { delivered: 1 })
      }
    }
    onCommand(id, handler) { commands.set(id, handler) }
    onShutdown(handler) { this.shutdown = handler }
    onReady(handler) { this.ready = handler }
    start() { this.ready?.() }
    invokeRoot() { return Promise.resolve({}) }
    invokeRootResource() { return Promise.resolve(fakeHandle(Buffer.from('{}'))) }
  }

  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === '@syllm/brickly-sdk') return { BricklyRuntime: FakeRuntime, ResourceHandle: FakeResourceHandle }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(ENTRY)]
    require(ENTRY)
  } finally {
    Module._load = originalLoad
  }
  t.after(async () => {
    delete require.cache[require.resolve(ENTRY)]
    await instance?.shutdown?.()
  })
  return { commands, published }
}

function fakeHandle(content) {
  const sha256 = createHash('sha256').update(content).digest('hex')
  return {
    fakeResource: true,
    content: content.toString('utf8'),
    ref: { kind: 'brickly.resource', resourceId: `res_${sha256.slice(0, 8)}`, accessToken: 'secret', sizeBytes: content.length, mimeType: 'application/octet-stream', sha256 },
    async text() { return content.toString('utf8') },
    async json() { return JSON.parse(content.toString('utf8')) },
    async *stream() { yield content },
    async close() {}, async revoke() {}
  }
}

function fakeWriter() {
  let aborted = false
  return {
    async write() {},
    async finish() {
      if (aborted) { const error = new Error('aborted'); error.code = 'RESOURCE_LIMIT_EXCEEDED'; throw error }
      return fakeHandle(Buffer.alloc(0))
    },
    async abort() { aborted = true }
  }
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not reached')
}
