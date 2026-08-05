const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const BRICK_ID = 'com.brickly.clipboard-history'
const HISTORY_EVENT = 'clipboard-history:changed'

test('只转发 Clipboard History 自身发布的变化事件', async () => {
  const harness = loadPreload()
  const received = []

  assert.ok(harness.api, 'preload 应暴露 clipboardHistoryEvents')
  const dispose = await harness.api.subscribe((envelope) => received.push(envelope))

  harness.notify({ event: 'other:event', sourceBrickId: BRICK_ID, payload: { revision: 1 } })
  harness.notify({ event: HISTORY_EVENT, sourceBrickId: 'com.example.other', payload: { revision: 2 } })
  harness.notify({ event: HISTORY_EVENT, sourceBrickId: BRICK_ID, payload: { revision: 3 } })

  assert.equal(received.length, 1)
  assert.equal(received[0].payload.revision, 3)
  assert.equal(
    JSON.stringify(harness.calls[0]),
    JSON.stringify(['platform.event.subscribe', { event: HISTORY_EVENT }])
  )

  await dispose()
  assert.equal(
    JSON.stringify(harness.calls.at(-1)),
    JSON.stringify(['platform.event.unsubscribe', { event: HISTORY_EVENT }])
  )
})

test('多个页面监听者共享宿主订阅并在最后取消时退订', async () => {
  const harness = loadPreload()
  const first = []
  const second = []

  const disposeFirst = await harness.api.subscribe((envelope) => first.push(envelope.payload.revision))
  const disposeSecond = await harness.api.subscribe((envelope) =>
    second.push(envelope.payload.revision)
  )

  assert.equal(harness.countCalls('platform.event.subscribe'), 1)
  await disposeFirst()
  await disposeFirst()
  assert.equal(harness.countCalls('platform.event.unsubscribe'), 0)

  harness.notify({ event: HISTORY_EVENT, sourceBrickId: BRICK_ID, payload: { revision: 4 } })
  assert.deepEqual(first, [])
  assert.deepEqual(second, [4])

  await disposeSecond()
  assert.equal(harness.countCalls('platform.event.unsubscribe'), 1)
})

test('宿主订阅暂时失败时执行有限重试', async () => {
  let attempts = 0
  const harness = loadPreload({
    invoke(channel) {
      if (channel === 'platform.event.subscribe') {
        attempts++
        if (attempts < 3) return Promise.reject(new Error('Brick 尚未注册'))
      }
      return Promise.resolve()
    },
    setTimeout(callback) {
      queueMicrotask(callback)
      return attempts
    }
  })

  const dispose = await harness.api.subscribe(() => {})

  assert.equal(attempts, 3)
  await dispose()
})

test('宿主订阅超过重试上限后拒绝并移除失败的 listener', async () => {
  let shouldFail = true
  let attempts = 0
  const harness = loadPreload({
    invoke(channel) {
      if (channel === 'platform.event.subscribe') {
        attempts++
        if (shouldFail) return Promise.reject(new Error('Brick 尚未注册'))
      }
      return Promise.resolve()
    },
    setTimeout(callback) {
      queueMicrotask(callback)
      return attempts
    }
  })
  const failedListenerCalls = []

  await assert.rejects(() => harness.api.subscribe(() => failedListenerCalls.push(true)), {
    message: 'Brick 尚未注册'
  })
  assert.equal(attempts, 8)

  shouldFail = false
  const activeListenerCalls = []
  const dispose = await harness.api.subscribe((envelope) =>
    activeListenerCalls.push(envelope.payload.revision)
  )
  harness.notify({ event: HISTORY_EVENT, sourceBrickId: BRICK_ID, payload: { revision: 5 } })

  assert.deepEqual(failedListenerCalls, [])
  assert.deepEqual(activeListenerCalls, [5])
  await dispose()
})

function loadPreload(options = {}) {
  const calls = []
  const exposed = {}
  const ipcListeners = new Map()
  const warnings = []
  const ipcRenderer = {
    invoke(...args) {
      calls.push(args)
      return options.invoke ? options.invoke(...args) : Promise.resolve()
    },
    on(channel, callback) {
      ipcListeners.set(channel, callback)
    }
  }
  const contextBridge = {
    exposeInMainWorld(key, api) {
      exposed[key] = api
    }
  }
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

  vm.runInNewContext(source, {
    console: {
      warn(...args) {
        warnings.push(args)
      }
    },
    process: { argv: [] },
    require(moduleId) {
      if (moduleId === 'electron') return { contextBridge, ipcRenderer }
      throw new Error(`Unexpected module: ${moduleId}`)
    },
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout
  })

  return {
    api: exposed.clipboardHistoryEvents,
    calls,
    warnings,
    countCalls(channel) {
      return calls.filter((args) => args[0] === channel).length
    },
    notify(envelope) {
      ipcListeners.get('platform.event.notify')?.({}, envelope)
    }
  }
}
