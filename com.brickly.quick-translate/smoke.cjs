/* eslint-disable no-console */
'use strict'

/**
 * Runtime 只走 Host gRPC，不再支持 stdin 上的 host.hello / BPP 0.4.0。
 * 这里只跑能本地执行的纯函数和 UI（window.brickly）检查。
 * 完整命令路径请在 Brickly 宿主里用热键验证。
 */

const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {
  selectedTextFromSnapshots,
  clipboardContentFromSnapshot,
  normalizeScreenBounds
} = require('./runtime/win-x64/lib/text-input')

function assert(value, message) {
  if (!value) throw new Error(message)
}

function assertEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertDeepEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function testSelectionHelpers() {
  assertDeepEqual(
    selectedTextFromSnapshots(
      { kind: 'text', hash: 'hash-old', text: 'Old clipboard' },
      { kind: 'text', hash: 'hash-old', text: 'Old clipboard' }
    ),
    { text: '', reason: 'clipboard-hash-unchanged' }
  )
  assertDeepEqual(
    selectedTextFromSnapshots(
      { kind: 'text', hash: 'hash-old', text: 'Old clipboard' },
      { kind: 'text', hash: 'hash-selected', text: 'Hello world' }
    ),
    { text: 'Hello world', reason: 'selected-text' }
  )
  assertDeepEqual(
    clipboardContentFromSnapshot({ kind: 'text', text: 'Old clipboard' }),
    { kind: 'text', text: 'Old clipboard' }
  )
  assertDeepEqual(normalizeScreenBounds({ x: 40.2, y: 50.8, width: 400, height: 200 }), {
    x: 40,
    y: 51,
    width: 400,
    height: 200
  })
  assertEqual(normalizeScreenBounds({ x: 0, y: 0, width: 0, height: 10 }), null)
}

function testUiUsesBrickly() {
  const listeners = new Map()
  const elements = {
    status: fakeElement(),
    source: fakeElement(),
    result: fakeElement({ classList: createClassList() }),
    error: fakeElement({ hidden: true }),
    copy: fakeElement({ disabled: true }),
    close: fakeElement()
  }
  const context = {
    console,
    window: {
      brickly: {
        on: (channel, handler) => listeners.set(channel, handler),
        notify: () => {}
      },
      requestAnimationFrame: (handler) => {
        handler()
        return 1
      },
      cancelAnimationFrame: () => {}
    },
    requestAnimationFrame: (handler) => {
      handler()
      return 1
    },
    cancelAnimationFrame: () => {},
    document: {
      getElementById: (id) => elements[id],
      querySelector: (selector) => (selector === '.shell' ? fakeElement({ scrollHeight: 160 }) : null),
      createElement: () => fakeElement()
    },
    navigator: { clipboard: { writeText: async () => {} } }
  }
  context.globalThis = context
  vm.runInNewContext(readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8'), context, {
    filename: 'ui/app.js'
  })

  assert(listeners.has('translate:start'), 'UI 应监听 translate:start')
  assert(listeners.has('translate:delta'), 'UI 应监听 translate:delta')
  assert(listeners.has('translate:result'), 'UI 应监听 translate:result')
  assert(!('AIBricks' in context.window), 'UI 不应依赖 window.AIBricks')

  listeners.get('translate:start')({ sourceText: 'Hello world' })
  assertEqual(elements.source.textContent, 'Hello world')
  listeners.get('translate:delta')({ delta: '你好' })
  assert(elements.result.textContent.includes('你好'), '流式 delta 应追加到译文')
  listeners.get('translate:result')({ sourceText: 'Hello world', translatedText: '你好，世界' })
  assertEqual(elements.result.textContent, '你好，世界')
}

function fakeElement(overrides = {}) {
  const el = {
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    className: '',
    classList: createClassList(),
    addEventListener: () => {},
    appendChild: (node) => {
      if (node && typeof node.textContent === 'string') {
        el.textContent = `${el.textContent || ''}${node.textContent}`
      }
    },
    ...overrides
  }
  return el
}

function createClassList() {
  const names = new Set()
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name)
  }
}

try {
  testSelectionHelpers()
  testUiUsesBrickly()
  console.log('OK: quick-translate local checks passed (no Host gRPC / no host.hello)')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
