const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const RUNTIME_PATH = path.join(__dirname, 'index.cjs')
const MANIFEST_PATH = path.join(__dirname, '..', '..', 'manifest.json')

test('manifest 使用 ResourceHandle 不需要资源权限', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  assert.equal(manifest.permissions.some((permission) => permission.startsWith('resource.')), false)
})

test('历史命令只委托给 Host clipboard.history API', async (t) => {
  const runtime = loadRuntime(t)
  const calls = []
  const item = {
    id: 'clip_1',
    kind: 'text',
    storageKind: 'blob',
    title: 'hello',
    preview: 'hello',
    favorite: false,
    entries: [],
    createdAt: 1,
    sizeBytes: 5,
    contentHash: 'hash'
  }
  const ctx = {
    platform: {
      clipboard: {
        history: {
          list: async (limit) => (calls.push(['list', limit]), [item]),
          readText: async (id) => (calls.push(['readText', id]), 'hello'),
          remove: async (id) => (calls.push(['remove', id]), true),
          clear: async (keep) => (calls.push(['clear', keep]), 1),
          setFavorite: async (id, favorite) => (calls.push(['favorite', id, favorite]), true),
          storageInfo: async () => ({ count: 1, blobCount: 1, blobBytes: 5 }),
          captureCurrent: async () => item
        },
        setContent: async (content) => content
      }
    }
  }

  const listed = await runtime.commands.get('list')(ctx, { limit: 20 })
  assert.equal(listed.items[0].type, 'text')
  assert.equal(await runtime.commands.get('read-text')(ctx, { id: 'clip_1' }), 'hello')
  assert.deepEqual(await runtime.commands.get('remove')(ctx, { id: 'clip_1' }), { ok: true })
  assert.deepEqual(await runtime.commands.get('clear')(ctx, { keepFavorites: true }), { ok: true, changed: 1 })
  assert.deepEqual(await runtime.commands.get('toggle-favorite')(ctx, { id: 'clip_1' }), { favorite: true })
  assert.deepEqual(calls, [
    ['list', 20],
    ['readText', 'clip_1'],
    ['remove', 'clip_1'],
    ['clear', true],
    ['list', 500],
    ['favorite', 'clip_1', true]
  ])
})

test('系统剪贴板事件只读取一层 ResourceHandle 并发布刷新事件', async (t) => {
  const runtime = loadRuntime(t)
  const handle = new runtime.ResourceHandle({ historyItemId: 'clip_1', kind: 'text' })

  runtime.events.get('clipboard:new-content')(handle, {
    event: 'clipboard:new-content',
    sourceBrickId: 'system',
    publishedAt: 10
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(handle.jsonCalls, 1)
  assert.equal(runtime.published.length, 1)
  assert.equal(runtime.published[0].event, 'clipboard-history:changed')
  assert.equal(runtime.published[0].payload.historyItemId, 'clip_1')
})

test('Runtime 不再加载 history-service 或创建独立数据目录', (t) => {
  const runtime = loadRuntime(t)
  assert.equal(runtime.loadedHistoryService, false)
  assert.equal(runtime.commands.has('read-text'), true)
})

function loadRuntime(t) {
  const commands = new Map()
  const events = new Map()
  const published = []
  let instance
  let loadedHistoryService = false

  class FakeResourceHandle {
    constructor(value) {
      this.value = value
      this.jsonCalls = 0
    }
    async json() {
      this.jsonCalls++
      return this.value
    }
  }

  class FakeBppError extends Error {
    constructor(code, message) {
      super(message)
      this.code = code
    }
  }

  class FakeRuntime {
    constructor() {
      instance = this
      this.log = { info() {}, warn() {} }
      this.events = {
        on: (event, handler) => events.set(event, handler),
        publish: async (event, payload) => (published.push({ event, payload }), { delivered: 1 })
      }
    }
    onCommand(id, handler) { commands.set(id, handler) }
    onReady(handler) { this.ready = handler }
    onShutdown(handler) { this.shutdown = handler }
    start() { this.ready?.() }
  }

  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === '@syllm/brickly-sdk') {
      return { BricklyRuntime: FakeRuntime, BppError: FakeBppError, ResourceHandle: FakeResourceHandle }
    }
    if (request.endsWith('history-service.cjs')) loadedHistoryService = true
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(RUNTIME_PATH)]
    require(RUNTIME_PATH)
  } finally {
    Module._load = originalLoad
  }
  t.after(() => {
    delete require.cache[require.resolve(RUNTIME_PATH)]
    instance?.shutdown?.()
  })

  return {
    commands,
    events,
    published,
    ResourceHandle: FakeResourceHandle,
    get loadedHistoryService() { return loadedHistoryService }
  }
}
