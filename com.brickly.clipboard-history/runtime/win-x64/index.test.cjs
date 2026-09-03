const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const RUNTIME_PATH = path.join(__dirname, 'index.cjs')
const MANIFEST_PATH = path.join(__dirname, '..', '..', 'manifest.json')

test('manifest 使用 ResourceHandle 不需要资源权限', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  assert.equal((manifest.permissions ?? []).some((permission) => permission.startsWith('resource.')), false)
  assert.equal(manifest.storage.quotaMB, 256)
  assert.equal(manifest.subscriptions[0].wake, true)
})

test('历史命令读写 brick.storage collection，不再委托 Host clipboard.history', async (t) => {
  const runtime = loadRuntime(t)
  const listed = await runtime.commands.get('list')({}, { limit: 20 })
  assert.deepEqual(listed.items, [])

  runtime.events.get('clipboard:new-content')({
    kind: 'text',
    hash: 'hash-hello',
    text: 'hello',
    capturedAt: 10
  })
  await flush()

  const after = await runtime.commands.get('list')({}, { limit: 20 })
  assert.equal(after.items.length, 1)
  assert.equal(after.items[0].type, 'text')
  assert.equal(after.items[0].preview, 'hello')
  assert.equal(await runtime.commands.get('read-text')({}, { id: after.items[0].id }), 'hello')
  assert.deepEqual(await runtime.commands.get('remove')({}, { id: after.items[0].id }), { ok: true })
  assert.deepEqual((await runtime.commands.get('list')({}, {})).items, [])
})

test('系统剪贴板事件入库后发布 clipboard-history:changed', async (t) => {
  const runtime = loadRuntime(t)
  runtime.events.get('clipboard:new-content')({
    kind: 'text',
    hash: 'hash-1',
    text: 'hello',
    capturedAt: 10
  })
  await flush()
  assert.equal(runtime.published.length, 1)
  assert.equal(runtime.published[0].event, 'clipboard-history:changed')
  assert.equal(runtime.published[0].payload.reason, 'insert')
})

test('重复 hash 发布 reuse 而不是 insert', async (t) => {
  const runtime = loadRuntime(t)
  runtime.events.get('clipboard:new-content')({
    kind: 'text',
    hash: 'hash-1',
    text: 'hello',
    capturedAt: 10
  })
  await flush()
  runtime.events.get('clipboard:new-content')({
    kind: 'text',
    hash: 'hash-1',
    text: 'hello',
    capturedAt: 11
  })
  await flush()
  assert.equal(runtime.published[1].payload.reason, 'reuse')
})

test('从历史写回剪贴板后回读入库；新 hash 发布 insert', async (t) => {
  const runtime = loadRuntime(t)
  const calls = []
  const ctx = {
    platform: {
      clipboard: {
        setContent: async (content) => (calls.push(['setContent', content.kind]), { kind: content.kind, formats: [], updatedAt: 2 }),
        readContent: async () => (calls.push(['readContent']), { kind: 'text', hash: 'hash', text: 'hello', capturedAt: 3 })
      }
    }
  }

  const result = await runtime.commands.get('set-content')(ctx, { content: { kind: 'text', text: 'hello' } })
  assert.equal(result.kind, 'text')
  assert.deepEqual(calls, [
    ['setContent', 'text'],
    ['readContent']
  ])
  assert.equal(runtime.published.length, 1)
  assert.equal(runtime.published[0].payload.reason, 'insert')
})

test('任一命令发布成功后清除之前失败留下的 lastError', async (t) => {
  const runtime = loadRuntime(t)
  runtime.events.get('clipboard:new-content')({
    kind: 'text',
    hash: 'hash-1',
    text: 'hello',
    capturedAt: 10
  })
  await flush()
  const id = (await runtime.commands.get('list')({}, {})).items[0].id

  runtime.runtime.events.publish = async () => {
    throw new Error('publish boom')
  }
  await runtime.commands.get('toggle-favorite')({}, { id, favorite: true })

  const failed = await runtime.commands.get('runtime-status')({})
  assert.equal(failed.state, 'error')
  assert.equal(failed.lastError, 'publish boom')

  runtime.runtime.events.publish = async () => {}
  await runtime.commands.get('remove')({}, { id })

  const recovered = await runtime.commands.get('runtime-status')({})
  assert.equal(recovered.state, 'running')
  assert.equal(recovered.lastError, undefined)
})

test('Runtime 不再加载 history-service 或创建独立数据目录', (t) => {
  const runtime = loadRuntime(t)
  assert.equal(runtime.loadedHistoryService, false)
  assert.equal(runtime.commands.has('read-text'), true)
})

test('图片 ResourceHandle 写到 brick.getPath(data)/blobs', async (t) => {
  const runtime = loadRuntime(t)
  const dests = []
  runtime.events.get('clipboard:new-content')({
    kind: 'image',
    hash: 'hash-img',
    mimeType: 'image/png',
    size: 12,
    capturedAt: 10,
    resource: {
      saveTo: async (dest) => {
        dests.push(dest)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, 'png-bytes')
      },
      ref: { sizeBytes: 12 }
    }
  })
  const listed = await waitForItems(runtime, 1)
  assert.equal(listed.items[0].storageKind, 'file')
  assert.equal(listed.items[0].imagePath, dests[0])
  assert.equal(path.basename(dests[0]), 'hash-img.png')
  assert.equal(path.basename(path.dirname(dests[0])), 'image')
  assert.equal(path.basename(path.dirname(path.dirname(dests[0]))), 'blobs')
  assert.equal(fs.existsSync(dests[0]), true)
})

test('超过 1MB 的文本写到 brick.getPath(data)/blobs', async (t) => {
  const runtime = loadRuntime(t)
  const text = 'x'.repeat(1024 * 1024 + 1)
  runtime.events.get('clipboard:new-content')({
    kind: 'text',
    hash: 'hash-big',
    text,
    capturedAt: 10
  })
  const listed = await waitForItems(runtime, 1)
  assert.equal(listed.items[0].storageKind, 'file')
  assert.equal(listed.items[0].text, undefined)
  const read = await runtime.commands.get('read-text')({}, { id: listed.items[0].id })
  assert.equal(read.length, text.length)
})

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitForItems(runtime, count) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const listed = await runtime.commands.get('list')({}, {})
    if (listed.items.length >= count) return listed
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const status = await runtime.commands.get('runtime-status')({})
  throw new Error(
    `clipboard history 未入库，期望至少 ${count} 条${status.lastError ? `：${status.lastError}` : ''}`
  )
}

function loadRuntime(t) {
  const commands = new Map()
  const events = new Map()
  const published = []
  const docs = new Map()
  let nextId = 1
  let instance
  let loadedHistoryService = false
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipboard-history-brick-'))

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
      this.storage = {
        collection() {
          return {
            async list(query = {}) {
              let items = [...docs.values()]
              if (query.equals) {
                items = items.filter((item) =>
                  Object.entries(query.equals).every(([key, value]) => item[key] === value)
                )
              }
              return items
            },
            async get(id) {
              return docs.get(id)
            },
            async create(data) {
              const doc = { id: `d_${nextId++}`, ...data }
              docs.set(doc.id, doc)
              return doc
            },
            async update(id, patch) {
              const current = docs.get(id)
              if (!current) return undefined
              Object.assign(current, patch)
              return current
            },
            async delete(id) {
              return docs.delete(id)
            }
          }
        }
      }
      this.getPath = async (name) => {
        if (name !== 'data') throw new Error(`unexpected path ${name}`)
        return dataDir
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
      return { BricklyRuntime: FakeRuntime, BppError: FakeBppError }
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
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  return {
    commands,
    events,
    published,
    get runtime() { return instance },
    get loadedHistoryService() { return loadedHistoryService }
  }
}
