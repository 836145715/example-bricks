/* eslint-disable no-console */
'use strict'

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-translate-smoke-'))
const fixtureImagePath = path.join(fixtureDir, 'ocr-shot.png')
fs.writeFileSync(
  fixtureImagePath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAIAAADGFbfiAAACDklEQVR4nO3UMQ0AAAwEoO1f2hQmBQsJqJzZ2QC8A8aBAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkDiAAIkDCJA4gACJAwiQOIAAiQMIkLgBuQ0C7xQ9ckIAAAAASUVORK5CYII=',
    'base64'
  )
)
fs.writeFileSync(
  fixtureImagePath,
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#f8fafc"/><rect x="64" y="62" width="150" height="50" fill="#e2e8f0"/><text x="70" y="94" font-size="26" font-family="Arial" fill="#111827">Hello world</text></svg>'
)

const runtime = spawn(process.execPath, [path.join(__dirname, 'runtime/node/index.js')], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
})

const messages = []
let buffer = ''
let nextWindowId = 1
let clipboardReadCount = 0
let scenario = 'no-selection'

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
  console.error(JSON.stringify(messages.slice(-12), null, 2))
  runtime.kill()
  fs.rmSync(fixtureDir, { recursive: true, force: true })
  process.exitCode = 1
})

async function main() {
  await waitFor((msg) => msg.type === 'runtime.ready')

  scenario = 'no-selection'
  clipboardReadCount = 0
  const noSelectionStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-no-selection',
      commandId: 'translate-selection',
      input: null
    }) + '\n'
  )
  const noSelection = await waitFor((msg) => msg.type === 'command.result' && msg.id === 'cmd-no-selection')
  assertDeepEqual(noSelection.result, { translated: false, reason: 'clipboard-hash-unchanged' })
  const noSelectionMessages = messages.slice(noSelectionStart)
  assert(!noSelectionMessages.some((msg) => msg.type === 'host.ui.createBrowserWindow'), 'no-selection 不应开窗')
  assert(!noSelectionMessages.some((msg) => msg.type === 'host.invoke'), 'no-selection 不应调用 OpenAI')
  assert(
    noSelectionMessages.some((msg) => msg.type === 'host.platform.clipboard.setContent'),
    'no-selection 后应恢复剪贴板'
  )

  scenario = 'selected'
  clipboardReadCount = 0
  const selectedStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-selected',
      commandId: 'translate-selection',
      input: null
    }) + '\n'
  )
  const selected = await waitFor((msg) => msg.type === 'command.result' && msg.id === 'cmd-selected')
  assertEqual(selected.result.translated, true)
  assertEqual(selected.result.sourceText, 'Hello world')
  assertEqual(selected.result.translatedText, '你好，世界')
  const selectedMessages = messages.slice(selectedStart)
  const restoreMessage = selectedMessages.find((msg) => msg.type === 'host.platform.clipboard.setContent')
  assert(restoreMessage, 'selected 后应恢复剪贴板')
  assertDeepEqual(restoreMessage.content, { kind: 'text', text: 'Old clipboard' })

  const sends = messages.filter(
    (msg) => msg.type === 'host.ui.callWindow' && msg.method === 'webContents.send'
  )
  assert(sends.some((msg) => msg.args[0] === 'translate:start'), '应发送 translate:start')
  assert(sends.some((msg) => msg.args[0] === 'translate:delta'), '应发送 translate:delta')
  assert(sends.some((msg) => msg.args[0] === 'translate:result'), '应发送 translate:result')

  send({
    type: 'event.notify',
    event: 'window.message',
    sourceBrickId: 'system',
    publishedAt: Date.now(),
    payload: {
      windowId: 1,
      channel: 'quick-translate:close',
      args: []
    }
  })
  await waitFor((msg) => msg.type === 'host.ui.closeWindow' && msg.windowId === 1)

  const overlayStart = messages.length
  runtime.stdin.write(
    JSON.stringify({
      type: 'command.invoke',
      id: 'cmd-screenshot-overlay',
      commandId: 'translate-screenshot-overlay',
      input: null
    }) + '\n'
  )
  const overlay = await waitFor(
    (msg) => msg.type === 'command.result' && msg.id === 'cmd-screenshot-overlay',
    8000
  )
  assertEqual(overlay.result.translated, true)
  assertEqual(overlay.result.blockCount, 1)
  assertDeepEqual(overlay.result.bounds, { x: 40, y: 50, width: 400, height: 200 })
  const overlayMessages = messages.slice(overlayStart)
  const overlayWindow = overlayMessages.find(
    (msg) => msg.type === 'host.ui.createBrowserWindow' && msg.url.endsWith('ui/overlay.html')
  )
  assert(overlayWindow, '截图翻译应创建 overlay 窗口')
  assertEqual(overlayWindow.options.x, 40)
  assertEqual(overlayWindow.options.y, 50)
  assertEqual(overlayWindow.options.width, 400)
  assertEqual(overlayWindow.options.height, 200)
  assertEqual(overlayWindow.options.transparent, true)
  assertEqual(overlayWindow.options.frame, false)
  assertEqual(overlayWindow.options.alwaysOnTop, true)

  const renderSend = overlayMessages.find(
    (msg) =>
      msg.type === 'host.ui.callWindow' &&
      msg.windowId === 2 &&
      msg.method === 'webContents.send' &&
      msg.args[0] === 'quick-translate-overlay:render'
  )
  assert(renderSend, '应向 overlay UI 发送渲染图片')
  assert(fs.existsSync(renderSend.args[1].imagePath), '覆盖翻译图片应已生成')

  send({
    type: 'event.notify',
    event: 'window.message',
    sourceBrickId: 'system',
    publishedAt: Date.now(),
    payload: {
      windowId: 2,
      channel: 'quick-translate-overlay:close',
      args: []
    }
  })
  await waitFor((msg) => msg.type === 'host.ui.closeWindow' && msg.windowId === 2)

  runtime.stdin.write(JSON.stringify({ type: 'runtime.shutdown' }) + '\n')
  await once(runtime, 'exit')
  fs.rmSync(fixtureDir, { recursive: true, force: true })
  console.log('OK: quick-translate smoke passed')
}

function handleMessage(msg) {
  if (msg.type === 'runtime.pong') return
  if (!msg.id) return
  if (msg.type === 'host.platform.clipboard.readContent') {
    clipboardReadCount += 1
    const result =
      scenario === 'selected' && clipboardReadCount > 1
        ? {
            kind: 'text',
            mimeType: 'text/plain',
            hash: 'hash-selected',
            text: 'Hello world',
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
    if (msg.url.endsWith('ui/index.html')) {
      assertEqual(msg.options.show, false)
      assertEqual(msg.options.x, 118)
      assertEqual(msg.options.y, 142)
    }
    send({ type: 'host.result', id: msg.id, result: { windowId: nextWindowId++, webContentsId: 10, url: msg.url } })
  } else if (msg.type === 'host.ui.callWindow') {
    send({ type: 'host.result', id: msg.id, result: null })
  } else if (msg.type === 'host.invoke') {
    if (msg.brickId === 'com.brickly.glm-ocr-screenshot') {
      assertEqual(msg.commandId, 'capture-text')
      assertEqual(msg.input.keepScreenshot, true)
      send({
        type: 'host.result',
        id: msg.id,
        result: {
          screenshotPath: fixtureImagePath,
          bounds: { x: 40, y: 50, width: 400, height: 200 },
          wordsText: 'Hello world',
          wordsResult: [
            {
              words: 'Hello world',
              location: { left: 70, top: 70, width: 130, height: 34 }
            }
          ],
          ocrResponse: {}
        }
      })
    } else if (msg.brickId === 'com.brickly.openai') {
      assertEqual(msg.commandId, 'chat-completions')
      assert(Array.isArray(msg.input.messages), '应使用 chat/completions messages 输入')
      if (msg.stream) {
        assertEqual(msg.input.stream, true)
        send({ type: 'host.invoke.chunk', id: msg.id, name: 'text', chunk: '你好，' })
        send({ type: 'host.invoke.chunk', id: msg.id, name: 'text', chunk: '世界' })
        send({ type: 'host.result', id: msg.id, result: { text: '你好，世界' } })
      } else {
        assertEqual(msg.input.stream, false)
        send({
          type: 'host.result',
          id: msg.id,
          result: { text: JSON.stringify([{ index: 0, translatedText: '你好，世界' }]) }
        })
      }
    }
  } else if (msg.type === 'host.ui.closeWindow') {
    send({ type: 'host.result', id: msg.id, result: null })
  }
}

function send(msg) {
  runtime.stdin.write(JSON.stringify(msg) + '\n')
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
