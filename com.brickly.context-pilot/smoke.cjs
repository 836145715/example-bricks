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
  normalizeOcrText
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
      { kind: 'text', hash: 'hash-selected', text: 'Tools for interacting with databases' }
    ),
    { text: 'Tools for interacting with databases', reason: 'selected-text' }
  )
  assertDeepEqual(
    clipboardContentFromSnapshot({ kind: 'text', text: 'Old clipboard' }),
    { kind: 'text', text: 'Old clipboard' }
  )
  assertEqual(
    normalizeOcrText({
      wordsText: 'The adapter exposes stable APIs for querying resources.',
      wordsResult: [{ words: 'The adapter exposes stable APIs for querying resources.' }]
    }),
    'The adapter exposes stable APIs for querying resources.'
  )
  assertEqual(normalizeOcrText({ wordsText: '', wordsResult: [] }), '')
}

function testUiIgnoresStaleAnalysisMessages() {
  const listeners = new Map()
  const elements = createFakeElements()
  const context = {
    console,
    window: {
      brickly: {
        on: (channel, handler) => listeners.set(channel, handler),
        sendToParent: () => {}
      },
      setTimeout: () => {},
      requestAnimationFrame: (handler) => {
        handler()
        return 1
      },
      cancelAnimationFrame: () => {}
    },
    document: {
      getElementById: (id) => elements.byId[id],
      querySelector: (selector) => {
        if (selector === '.shell') return elements.shell
        const match = /^\[data-section="([^"]+)"\](?: \.section-body)?$/.exec(selector)
        if (!match) return null
        const section = elements.sections[match[1]]
        return selector.endsWith('.section-body') ? section.body : section
      }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    requestAnimationFrame: (handler) => {
      handler()
      return 1
    },
    cancelAnimationFrame: () => {}
  }
  context.globalThis = context
  vm.runInNewContext(readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8'), context, {
    filename: 'ui/app.js'
  })

  assert(!('AIBricks' in context.window), 'UI 不应依赖 window.AIBricks')

  listeners.get('context-pilot:start')({
    requestId: 'newer',
    sourceText: 'new source'
  })
  listeners.get('context-pilot:delta')({
    requestId: 'older',
    delta: '[SECTION:natural_translation]\n旧内容'
  })
  assert(
    !elements.sections.natural_translation.body.innerHTML.includes('旧内容'),
    '旧 requestId 的 delta 不应被渲染'
  )

  listeners.get('context-pilot:delta')({
    requestId: 'newer',
    delta: '[SECTION:natural_translation]\n新内容'
  })
  assert(
    elements.sections.natural_translation.body.innerHTML.includes('新内容'),
    '当前 requestId 的 delta 应被渲染'
  )

  listeners.get('context-pilot:result')({
    requestId: 'older',
    markdown: '[SECTION:natural_translation]\n旧结果',
    sourceText: 'old source'
  })
  assertEqual(elements.byId.source.textContent, 'new source')
}

function createFakeElements() {
  const byId = {
    status: fakeElement({ lastChild: { textContent: '' } }),
    'status-dot': fakeElement(),
    source: fakeElement(),
    sections: fakeElement(),
    fallback: fakeElement(),
    error: fakeElement(),
    copy: fakeElement(),
    close: fakeElement()
  }
  const sections = {}
  for (const key of [
    'natural_translation',
    'literal_translation',
    'skeleton',
    'chunks',
    'patterns'
  ]) {
    sections[key] = fakeElement()
    sections[key].body = fakeElement()
  }
  return {
    byId,
    sections,
    shell: fakeElement({ scrollHeight: 420 })
  }
}

function fakeElement(overrides = {}) {
  return {
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    dataset: {},
    className: '',
    lastChild: { textContent: '' },
    scrollHeight: 0,
    addEventListener: () => {},
    classList: {
      add: () => {},
      remove: () => {}
    },
    ...overrides
  }
}

try {
  testSelectionHelpers()
  testUiIgnoresStaleAnalysisMessages()
  console.log('OK: context-pilot local checks passed (no Host gRPC / no host.hello)')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
