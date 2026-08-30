const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const RUNTIME_PATH = path.join(__dirname, 'index.cjs')
const MANIFEST_PATH = path.join(__dirname, '..', '..', 'manifest.json')

test('manifest 使用 ResourceHandle 不需要资源权限', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  assert.equal((manifest.permissions ?? []).some((permission) => permission.startsWith('resource.')), false)
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
  // 显式目标状态：跳过全量 list 查找，直接写入
  assert.deepEqual(await runtime.commands.get('toggle-favorite')(ctx, { id: 'clip_1', favorite: false }), { favorite: false })
  assert.deepEqual(calls, [
    ['list', 20],
    ['readText', 'clip_1'],
    ['remove', 'clip_1'],
    ['clear', true],
    ['list', 500],
    ['favorite', 'clip_1', true],
    ['favorite', 'clip_1', false]
  ])
})

test('系统剪贴板事件读取普通 payload 并发布刷新事件', async (t) => {
  const runtime = loadRuntime(t)

  runtime.events.get('clipboard:new-content')(
    { historyItemId: 'clip_1', kind: 'text', count: 3 },
    {
      event: 'clipboard:new-content',
      sourceBrickId: 'system',
      publishedAt: 10
    }
  )
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runtime.published.length, 1)
  assert.equal(runtime.published[0].event, 'clipboard-history:changed')
  assert.equal(runtime.published[0].payload.historyItemId, 'clip_1')
  assert.equal(runtime.published[0].payload.reason, 'insert')
})

test('宿主回报重复入库时发布 reuse 而不是 insert', async (t) => {
  const runtime = loadRuntime(t)

  runtime.events.get('clipboard:new-content')(
    { historyItemId: 'clip_1', kind: 'text', count: 3, reason: 'duplicate' },
    {
      event: 'clipboard:new-content',
      sourceBrickId: 'system',
      publishedAt: 10
    }
  )
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runtime.published[0].payload.reason, 'reuse')
  assert.equal(runtime.published[0].payload.historyItemId, 'clip_1')
})

test('从历史写回剪贴板后回读入库并发布 reuse', async (t) => {
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
    createdAt: 3,
    sizeBytes: 5,
    contentHash: 'hash'
  }
  const ctx = {
    platform: {
      clipboard: {
        history: {
          captureCurrent: async () => (calls.push(['captureCurrent']), item),
          storageInfo: async () => (calls.push(['storageInfo']), { count: 2 })
        },
        setContent: async (content) => (calls.push(['setContent', content.kind]), { kind: content.kind, formats: [], updatedAt: 2 })
      }
    }
  }

  const result = await runtime.commands.get('set-content')(ctx, { content: { kind: 'text', text: 'hello' } })

  assert.equal(result.kind, 'text')
  assert.deepEqual(calls, [
    ['setContent', 'text'],
    ['captureCurrent'],
    ['storageInfo']
  ])
  assert.equal(runtime.published.length, 1)
  assert.equal(runtime.published[0].event, 'clipboard-history:changed')
  assert.equal(runtime.published[0].payload.reason, 'reuse')
  assert.equal(runtime.published[0].payload.historyItemId, 'clip_1')
})

test('任一命令发布成功后清除之前失败留下的 lastError', async (t) => {
  const runtime = loadRuntime(t)
  const calls = []
  const ctx = {
    platform: {
      clipboard: {
        history: {
          list: async (limit) => (calls.push(['list', limit]), []),
          setFavorite: async (id, favorite) => (calls.push(['favorite', id, favorite]), true),
          remove: async (id) => (calls.push(['remove', id]), true),
          storageInfo: async () => ({ count: 1 })
        }
      }
    }
  }

  runtime.runtime.events.publish = async () => {
    throw new Error('publish boom')
  }
  await runtime.commands.get('toggle-favorite')(ctx, { id: 'clip_1', favorite: true })

  const failed = await runtime.commands.get('runtime-status')(ctx)
  assert.equal(failed.state, 'error')
  assert.equal(failed.lastError, 'publish boom')

  runtime.runtime.events.publish = async () => {}
  await runtime.commands.get('remove')(ctx, { id: 'clip_1' })

  const recovered = await runtime.commands.get('runtime-status')(ctx)
  assert.equal(recovered.state, 'running')
  assert.equal(recovered.lastError, undefined)
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
      this.resources = {
        open() {
          throw new Error('resources.open not stubbed')
        }
      }
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
    get runtime() { return instance },
    ResourceHandle: FakeResourceHandle,
    get resources() { return instance.resources },
    get loadedHistoryService() { return loadedHistoryService }
  }
}
