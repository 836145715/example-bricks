const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const RUNTIME_PATH = path.join(__dirname, 'index.cjs')
const MANIFEST_PATH = path.join(__dirname, '..', '..', 'manifest.json')
const HISTORY_EVENT = 'clipboard-history:changed'

test('Runtime 只注册有限时长命令且 manifest 声明 clipboard 权限', (t) => {
  const runtime = loadRuntime(t)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const commandIds = manifest.commands.map((command) => command.id)

  assert.deepEqual(
    [...runtime.commands.keys()].sort(),
    [
      'clear',
      'list',
      'remove',
      'runtime-status',
      'set-content',
      'storage-info',
      'sync-now',
      'toggle-favorite'
    ]
  )
  assert.equal(runtime.commands.has('watch'), false)
  assert.equal(manifest.permissions.includes('os.clipboard'), true)
  assert.equal(commandIds.includes('sync-now'), true)
  assert.equal(commandIds.includes('set-content'), true)
  assert.equal(commandIds.includes('runtime-status'), true)
  assert.equal(commandIds.includes('watch'), false)
})

test('sync-now 读取 Runtime clipboard 并发布不含正文的公开事件', async (t) => {
  const runtime = loadRuntime(t)
  const result = await runtime.commands.get('sync-now')(
    {
      platform: {
        clipboard: {
          readContent: async () => ({ kind: 'text', text: 'hello', capturedAt: 10 })
        }
      }
    },
    {}
  )

  assert.equal(result.changed, true)
  assert.equal(result.reason, 'sync')
  assert.equal(runtime.published.length, 1)
  assert.equal(runtime.published[0].event, HISTORY_EVENT)
  assert.equal(runtime.published[0].payload.revision, 1)
  assert.equal(runtime.published[0].payload.count, 1)
  assert.equal(runtime.published[0].payload.reason, 'sync')
  assert.equal(typeof runtime.published[0].payload.at, 'number')
  assert.equal('text' in runtime.published[0].payload, false)
  assert.equal('items' in runtime.published[0].payload, false)

  const status = await runtime.commands.get('runtime-status')({}, {})
  assert.equal(status.state, 'running')
  assert.equal(status.count, 1)
  assert.equal(status.revision, 1)
  assert.equal(status.processedEvents, 1)
})

test('sync-now 忽略空剪贴板快照且不发布变化事件', async (t) => {
  const runtime = loadRuntime(t)
  const result = await runtime.commands.get('sync-now')(
    {
      platform: {
        clipboard: {
          readContent: async () => ({ capturedAt: 10 })
        }
      }
    },
    {}
  )

  assert.equal(result.changed, false)
  assert.equal(result.reason, 'sync')
  assert.equal(runtime.published.length, 0)
  const list = await runtime.commands.get('list')({}, {})
  assert.deepEqual(list.items, [])
  const status = await runtime.commands.get('runtime-status')({}, {})
  assert.equal(status.revision, 0)
})

test('set-content 只调用 Runtime clipboard API 并校验 content', async (t) => {
  const runtime = loadRuntime(t)
  const calls = []
  const ctx = {
    platform: {
      clipboard: {
        setContent: async (content) => {
          calls.push(content)
          return { kind: content.kind, formats: ['text/plain'], updatedAt: 20 }
        }
      }
    }
  }

  const result = await runtime.commands.get('set-content')(ctx, {
    content: { kind: 'text', text: 'copy me' }
  })

  assert.deepEqual(calls, [{ kind: 'text', text: 'copy me' }])
  assert.equal(result.kind, 'text')
  await assert.rejects(() => runtime.commands.get('set-content')(ctx, {}), {
    code: 'INVALID_INPUT'
  })
})

test('系统事件使用 ResourceHandle 读取嵌套剪贴板资源', async (t) => {
  const runtime = loadRuntime(t)
  const inner = new runtime.ResourceHandle({
    kind: 'brickly.resource',
    resourceId: 'clipboard-resource',
    accessToken: 'token',
    sizeBytes: 5,
    mimeType: 'text/plain'
  }, 'hello')
  runtime.ResourceHandle.values.set('clipboard-resource', 'hello')
  const outer = new runtime.ResourceHandle({
    kind: 'brickly.resource',
    resourceId: 'event-resource',
    accessToken: 'token',
    sizeBytes: 100,
    mimeType: 'application/json'
  }, { kind: 'text', mimeType: 'text/plain', resource: inner.ref })

  runtime.events.get('clipboard:new-content')(outer, {
    event: 'clipboard:new-content',
    sourceBrickId: 'system',
    publishedAt: Date.now()
  })
  await new Promise((resolve) => setImmediate(resolve))

  const list = await runtime.commands.get('list')({}, { limit: 10 })
  assert.equal(list.items[0].text, 'hello')
})

test('系统事件将图片 ResourceHandle 保存到历史媒体目录', async (t) => {
  const runtime = loadRuntime(t)
  const inner = new runtime.ResourceHandle({
    kind: 'brickly.resource',
    resourceId: 'clipboard-image',
    accessToken: 'token',
    sizeBytes: 3,
    mimeType: 'image/png',
    name: 'capture.png'
  }, 'png')
  runtime.ResourceHandle.values.set('clipboard-image', 'png')
  const outer = new runtime.ResourceHandle({
    kind: 'brickly.resource',
    resourceId: 'event-image',
    accessToken: 'token',
    sizeBytes: 100,
    mimeType: 'application/json'
  }, { kind: 'image', mimeType: 'image/png', resource: inner.ref })

  runtime.events.get('clipboard:new-content')(outer, {
    event: 'clipboard:new-content',
    sourceBrickId: 'system',
    publishedAt: Date.now()
  })
  await new Promise((resolve) => setImmediate(resolve))

  const list = await runtime.commands.get('list')({}, { limit: 10 })
  assert.equal(list.items[0].type, 'image')
  assert.equal(fs.readFileSync(list.items[0].imagePath, 'utf8'), 'png')
})

test('系统事件 listener 吸收异步落盘失败且不返回 rejected Promise', async (t) => {
  const runtime = loadRuntime(t)
  fs.mkdirSync(runtime.dbPath)

  const returned = runtime.events.get('clipboard:new-content')(
    { kind: 'text', text: 'cannot-persist' },
    {
      event: 'clipboard:new-content',
      sourceBrickId: 'system',
      publishedAt: Date.now()
    }
  )
  returned?.catch?.(() => {})

  assert.equal(returned, undefined)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.published.length, 0)
  assert.match(runtime.logs.map((entry) => entry[1]).join('\n'), /failed/)
})

test('没有真实变化时不发布，发布失败也不回滚已保存状态', async (t) => {
  const runtime = loadRuntime(t, { publishError: new Error('event bus unavailable') })
  const ctx = {
    platform: {
      clipboard: {
        readContent: async () => ({ kind: 'text', text: 'saved', capturedAt: 10 })
      }
    }
  }

  const first = await runtime.commands.get('sync-now')(ctx, {})
  const duplicate = await runtime.commands.get('sync-now')(ctx, {})
  const missing = await runtime.commands.get('remove')({}, { id: 'missing' })

  assert.equal(first.changed, true)
  assert.equal(duplicate.changed, false)
  assert.equal(missing.ok, false)
  assert.equal(runtime.publishAttempts, 1)
  const list = await runtime.commands.get('list')({}, {})
  assert.equal(list.items[0].text, 'saved')
})

function loadRuntime(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brickly-runtime-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const commands = new Map()
  const events = new Map()
  const published = []
  const logs = []
  let publishAttempts = 0
  let instance

  class FakeBppError extends Error {
    constructor(code, message) {
      super(message)
      this.code = code
    }
  }

  class FakeResourceHandle {
    constructor(transportOrRef, refOrValue) {
      if (refOrValue && refOrValue.kind === 'brickly.resource') {
        this.ref = refOrValue
        this.value = FakeResourceHandle.values.get(refOrValue.resourceId)
      } else {
        this.ref = transportOrRef
        this.value = refOrValue
      }
    }

    async json() {
      return this.value
    }

    async text() {
      return String(this.value)
    }

    async saveTo(destination) {
      fs.writeFileSync(destination, Buffer.from(String(this.value)))
    }
  }
  FakeResourceHandle.values = new Map()

  class FakeBricklyRuntime {
    constructor() {
      instance = this
      this.log = {
        info: (message) => logs.push(['info', message]),
        warn: (message) => logs.push(['warn', message])
      }
      this.transport = {
        hostCall: options.hostCall ?? (async () => null)
      }
      this.events = {
        on: (event, handler) => events.set(event, handler),
        publish: async (event, payload) => {
          publishAttempts++
          if (options.publishError) throw options.publishError
          published.push({ event, payload })
          return { delivered: 1 }
        }
      }
    }

    onCommand(command, handler) {
      commands.set(command, handler)
    }

    onReady(handler) {
      this.readyHandler = handler
    }

    onShutdown(handler) {
      this.shutdownHandler = handler
    }

    start() {
      this.readyHandler?.()
    }
  }

  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@syllm/brickly-sdk') {
      return {
        BricklyRuntime: FakeBricklyRuntime,
        BppError: FakeBppError,
        ResourceHandle: FakeResourceHandle
      }
    }
    if (request === 'node:os' && parent?.filename === RUNTIME_PATH) {
      return { homedir: () => root }
    }
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
    instance?.shutdownHandler?.()
  })

  return {
    commands,
    events,
    published,
    logs,
    ResourceHandle: FakeResourceHandle,
    dbPath: path.join(root, '.brickly', 'apps', 'com.brickly.clipboard-history', 'history.json'),
    get publishAttempts() {
      return publishAttempts
    }
  }
}
