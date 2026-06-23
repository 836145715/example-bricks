/* eslint-disable no-console */
'use strict'

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const runtime = spawn(process.execPath, [path.join(__dirname, 'runtime/node/index.js')], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
})

const messages = []
let buffer = ''
let nextWindowId = 1
let clipboardReadCount = 0
let scenario = 'no-selection'
const expectedCopyModifier = process.platform === 'darwin' ? 'meta' : 'control'

runtime.stdout.setEncoding('utf8')
runtime.stdout.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    messages.push(msg)
    handleMessage(msg)
  }
})

runtime.stderr.setEncoding('utf8')
runtime.stderr.on('data', (chunk) => process.stderr.write(chunk))

runtime.stdin.write(JSON.stringify({ type: 'host.hello', protocolVersion: '0.1.0' }) + '\n')

main().catch(async (error) => {
  console.error(error)
  runtime.kill()
  process.exitCode = 1
})

async function main() {
  testUiIgnoresStaleAnalysisMessages()

  await waitFor((msg) => msg.type === 'runtime.ready')

  scenario = 'no-selection'
  clipboardReadCount = 0
  const noSelectionStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-no-selection',
      commandId: 'analyze-selection',
      input: null
    }) + '\n'
  )
  const noSelection = await waitFor((msg) => msg.type === 'command.result' && msg.id === 'cmd-no-selection')
  assertDeepEqual(noSelection.result, { analyzed: false, reason: 'clipboard-hash-unchanged' })
  const noSelectionMessages = messages.slice(noSelectionStart)
  assert(!noSelectionMessages.some((msg) => msg.type === 'host.ui.createBrowserWindow'), 'no-selection 不应开窗')
  assert(!noSelectionMessages.some((msg) => msg.type === 'host.invoke'), 'no-selection 不应调用 OpenAI')
  assert(
    noSelectionMessages.some((msg) => msg.type === 'host.platform.clipboard.setContent'),
    'no-selection 后应恢复剪贴板'
  )
  assertCopyShortcut(noSelectionMessages)

  scenario = 'selected'
  clipboardReadCount = 0
  const selectedStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-selected',
      commandId: 'analyze-selection',
      input: null
    }) + '\n'
  )
  const selected = await waitFor((msg) => msg.type === 'command.result' && msg.id === 'cmd-selected')
  assertEqual(selected.result.analyzed, true)
  assertEqual(selected.result.source, 'selection')
  assertEqual(selected.result.sourceText, 'Tools for interacting with databases')
  assert(selected.result.markdown.includes('[SECTION:natural_translation]'), '应返回协议化 Markdown')
  const selectedMessages = messages.slice(selectedStart)
  assertCopyShortcut(selectedMessages)
  const restoreMessage = selectedMessages.find((msg) => msg.type === 'host.platform.clipboard.setContent')
  assert(restoreMessage, 'selected 后应恢复剪贴板')
  assertDeepEqual(restoreMessage.content, { kind: 'text', text: 'Old clipboard' })

  const invoke = selectedMessages.find((msg) => msg.type === 'host.invoke')
  assert(invoke, '有选区时应调用 OpenAI')
  assertEqual(invoke.brickId, 'com.brickly.openai')
  assertEqual(invoke.commandId, 'chat-completions')
  assertEqual(invoke.stream, true)
  assertEqual(invoke.input.stream, true)
  assert(JSON.stringify(invoke.input.messages).includes('[SECTION:natural_translation]'), 'prompt 应要求协议化 section')

  const sends = messages.filter(
    (msg) => msg.type === 'host.ui.callWindow' && msg.method === 'webContents.send'
  )
  assert(sends.some((msg) => msg.args[0] === 'context-pilot:start'), '应发送 context-pilot:start')
  assert(sends.some((msg) => msg.args[0] === 'context-pilot:delta'), '应发送 context-pilot:delta')
  assert(sends.some((msg) => msg.args[0] === 'context-pilot:result'), '应发送 context-pilot:result')
  assertAnalysisMessagesHaveSameId(sends)

  scenario = 'openai-error'
  clipboardReadCount = 0
  const errorStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-openai-error',
      commandId: 'analyze-selection',
      input: null
    }) + '\n'
  )
  const failed = await waitFor((msg) => msg.type === 'command.error' && msg.id === 'cmd-openai-error')
  assertEqual(failed.error.code, 'OPENAI_FAILED')
  assertEqual(failed.error.message, '模型调用失败')
  const errorMessages = messages.slice(errorStart)
  assertCopyShortcut(errorMessages)
  const errorPayload = errorMessages.find(
    (msg) => msg.type === 'host.ui.callWindow' && msg.args[0] === 'context-pilot:error'
  )?.args?.[1]
  assert(errorPayload, 'OpenAI 失败时应通知窗口错误态')
  assertEqual(errorPayload.error, '模型调用失败')
  assertEqual(errorPayload.requestId, 'cmd-openai-error')
  assert(!('analysisId' in errorPayload), 'OpenAI 失败消息不应再携带插件自生成 analysisId')

  scenario = 'cancelled'
  clipboardReadCount = 0
  const cancelStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-cancelled',
      commandId: 'analyze-selection',
      input: null
    }) + '\n'
  )
  await waitFor(
    (msg) =>
      msg.type === 'host.ui.callWindow' &&
      msg.method === 'webContents.send' &&
      msg.args[0] === 'context-pilot:start'
  )
  runtime.stdin.write(JSON.stringify({ type: 'command.cancel', id: 'cmd-cancelled' }) + '\n')
  const cancelled = await waitFor((msg) => msg.type === 'command.error' && msg.id === 'cmd-cancelled')
  assertEqual(cancelled.error.code, 'CANCELLED')
  const cancelMessages = messages.slice(cancelStart)
  assert(
    !cancelMessages.some(
      (msg) => msg.type === 'host.ui.callWindow' && msg.args[0] === 'context-pilot:result'
    ),
    '取消后不应继续发送 context-pilot:result'
  )

  scenario = 'screenshot'
  clipboardReadCount = 0
  const screenshotStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-screenshot',
      commandId: 'analyze-screenshot',
      input: null
    }) + '\n'
  )
  const screenshot = await waitFor((msg) => msg.type === 'command.result' && msg.id === 'cmd-screenshot')
  assertEqual(screenshot.result.analyzed, true)
  assertEqual(screenshot.result.source, 'screenshot')
  assertEqual(screenshot.result.sourceText, 'The adapter exposes stable APIs for querying resources.')
  const screenshotMessages = messages.slice(screenshotStart)
  const ocrInvoke = screenshotMessages.find(
    (msg) => msg.type === 'host.invoke' && msg.brickId === 'com.brickly.glm-ocr-screenshot'
  )
  assert(ocrInvoke, '截图命令应先调用 GLM OCR 文本能力')
  assertEqual(ocrInvoke.commandId, 'capture-text')
  assertEqual(ocrInvoke.input.languageType, 'AUTO')
  assertEqual(ocrInvoke.input.keepScreenshot, false)
  assert(!screenshotMessages.some((msg) => msg.type === 'host.platform.input.keyboardTap'), '截图命令不应模拟复制')
  const screenshotOpenAI = screenshotMessages.find(
    (msg) => msg.type === 'host.invoke' && msg.brickId === 'com.brickly.openai'
  )
  assert(screenshotOpenAI, '截图 OCR 成功后应调用 OpenAI')
  assert(JSON.stringify(screenshotOpenAI.input.messages).includes('adapter exposes stable APIs'), 'prompt 应包含 OCR 文本')

  scenario = 'screenshot-empty'
  const screenshotEmptyStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-screenshot-empty',
      commandId: 'analyze-screenshot',
      input: null
    }) + '\n'
  )
  const screenshotEmpty = await waitFor(
    (msg) => msg.type === 'command.result' && msg.id === 'cmd-screenshot-empty'
  )
  assertDeepEqual(screenshotEmpty.result, {
    analyzed: false,
    reason: 'ocr-empty-text',
    ocrResult: { wordsText: '', wordsResult: [] }
  })
  const screenshotEmptyMessages = messages.slice(screenshotEmptyStart)
  assert(
    !screenshotEmptyMessages.some((msg) => msg.type === 'host.ui.createBrowserWindow'),
    'OCR 空文本时不应开窗'
  )
  assert(
    !screenshotEmptyMessages.some((msg) => msg.type === 'host.invoke' && msg.brickId === 'com.brickly.openai'),
    'OCR 空文本时不应调用 OpenAI'
  )

  send({
    type: 'event.notify',
    event: 'window.message',
    sourceBrickId: 'system',
    publishedAt: Date.now(),
    payload: {
      windowId: 1,
      channel: 'context-pilot:close',
      args: []
    }
  })
  await waitFor((msg) => msg.type === 'host.ui.closeWindow' && msg.windowId === 1)

  runtime.stdin.write(JSON.stringify({ type: 'runtime.shutdown' }) + '\n')
  await once(runtime, 'exit')
  console.log('OK: context-pilot smoke passed')
}

function handleMessage(msg) {
  if (msg.type === 'runtime.pong') return
  if (!msg.id) return
  if (msg.type === 'host.platform.clipboard.readContent') {
    clipboardReadCount += 1
    const result =
      (scenario === 'selected' || scenario === 'openai-error' || scenario === 'cancelled') &&
      clipboardReadCount > 1
        ? {
            kind: 'text',
            mimeType: 'text/plain',
            hash: 'hash-selected',
            text: 'Tools for interacting with databases',
            capturedAt: 2
          }
        : {
            kind: 'text',
            mimeType: 'text/plain',
            hash: 'hash-old',
            text: 'Old clipboard',
            capturedAt: 1
          }
    send({ type: 'host.result', id: msg.id, result })
  } else if (msg.type === 'host.platform.clipboard.setContent') {
    send({
      type: 'host.result',
      id: msg.id,
      result: { kind: msg.content.kind, formats: ['text/plain'], updatedAt: Date.now() }
    })
  } else if (msg.type === 'host.platform.input.keyboardTap') {
    send({ type: 'host.result', id: msg.id })
  } else if (msg.type === 'host.platform.screen.getCursorScreenPoint') {
    send({ type: 'host.result', id: msg.id, result: { x: 100, y: 120 } })
  } else if (msg.type === 'host.platform.screen.getDisplayNearestPoint') {
    send({
      type: 'host.result',
      id: msg.id,
      result: { workArea: { x: 0, y: 0, width: 1280, height: 720 } }
    })
  } else if (msg.type === 'host.ui.createBrowserWindow') {
    assertEqual(msg.options.frame, false)
    assertEqual(msg.options.transparent, true)
    assertEqual(msg.options.show, false)
    assertEqual(msg.options.x, 118)
    assertEqual(msg.options.y, 142)
    send({ type: 'host.result', id: msg.id, result: { windowId: nextWindowId++, webContentsId: 10, url: msg.url } })
  } else if (msg.type === 'host.ui.callWindow') {
    send({ type: 'host.result', id: msg.id, result: null })
  } else if (msg.type === 'host.invoke') {
    if (msg.brickId === 'com.brickly.glm-ocr-screenshot') {
      assertEqual(msg.commandId, 'capture-text')
      send({
        type: 'host.result',
        id: msg.id,
        result:
          scenario === 'screenshot-empty'
            ? { wordsText: '', wordsResult: [] }
            : {
                wordsText: 'The adapter exposes stable APIs for querying resources.',
                wordsResult: [{ words: 'The adapter exposes stable APIs for querying resources.' }]
              }
      })
      return
    }
    assertEqual(msg.brickId, 'com.brickly.openai')
    assertEqual(msg.commandId, 'chat-completions')
    assertEqual(msg.stream, true)
    assertEqual(msg.input.stream, true)
    assert(Array.isArray(msg.input.messages), '应使用 chat/completions messages 输入')
    if (scenario === 'openai-error') {
      send({
        type: 'host.error',
        id: msg.id,
        error: { code: 'OPENAI_FAILED', message: '模型调用失败', details: { status: 401 } }
      })
      return
    }
    if (scenario === 'cancelled') return
    send({ type: 'host.invoke.chunk', id: msg.id, name: 'text', chunk: '[SECTION:natural_translation]\n用于' })
    send({ type: 'host.invoke.chunk', id: msg.id, name: 'text', chunk: '和数据库交互的工具\n[SECTION:skeleton]\nS: Tools' })
    send({
      type: 'host.result',
      id: msg.id,
      result: {
        text: '[SECTION:natural_translation]\n用于和数据库交互的工具\n[SECTION:skeleton]\nS: Tools'
      }
    })
  } else if (msg.type === 'host.ui.closeWindow') {
    send({ type: 'host.result', id: msg.id, result: null })
  }
}

function send(msg) {
  runtime.stdin.write(JSON.stringify(msg) + '\n')
}

function assertCopyShortcut(items) {
  const keyboardTap = items.find((msg) => msg.type === 'host.platform.input.keyboardTap')
  assert(keyboardTap, '应模拟复制当前选区')
  assertDeepEqual(keyboardTap.payload, { key: 'c', modifiers: [expectedCopyModifier] })
}

function assertAnalysisMessagesHaveSameId(items) {
  const payloads = items
    .filter((msg) =>
      ['context-pilot:start', 'context-pilot:delta', 'context-pilot:result'].includes(msg.args[0])
    )
    .map((msg) => msg.args[1])
  assert(payloads.length >= 3, '应至少包含 start/delta/result 三类消息')
  const ids = new Set(payloads.map((payload) => payload?.requestId).filter(Boolean))
  assertEqual(ids.size, 1)
  assert(ids.has('cmd-selected'), '窗口消息应使用宿主 command.invoke id 作为 requestId')
  assert(
    payloads.every((payload) => !payload || !('analysisId' in payload)),
    '窗口消息不应再携带插件自生成 analysisId'
  )
}

function waitFor(predicate, timeoutMs = 3000) {
  const existing = messages.find(predicate)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('timeout waiting for message'))
    }, timeoutMs)
    const onData = () => {
      const found = messages.find(predicate)
      if (!found) return
      cleanup()
      resolve(found)
    }
    const cleanup = () => {
      clearTimeout(timeout)
      runtime.stdout.off('data', onData)
    }
    runtime.stdout.on('data', onData)
  })
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

function assertEqual(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function assertDeepEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
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
  vm.runInNewContext(
    readFileSync(path.join(__dirname, 'ui/app.js'), 'utf8'),
    context,
    { filename: 'ui/app.js' }
  )

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
