/* eslint-disable */
'use strict'

const BRICK_ID = 'com.brickly.input-demo'
const PROTOCOL_VERSION = '0.1.0'

let buffer = ''
let nextHostCall = 1
const pending = new Map()
const cancelled = new Set()

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function log(message, details) {
  process.stderr.write(`[input-demo] ${message}${details ? ' ' + JSON.stringify(details) : ''}\n`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForStart(commandId, delayMs) {
  const delay = clampNumber(delayMs, 0, 10000, 0)
  if (delay <= 0) return
  const startedAt = Date.now()
  while (Date.now() - startedAt < delay) {
    ensureNotCancelled(commandId)
    const elapsed = Date.now() - startedAt
    send({
      type: 'command.progress',
      id: commandId,
      progress: Math.min(elapsed / delay, 0.95),
      message: `请把焦点切到目标窗口，${Math.ceil((delay - elapsed) / 1000)} 秒后执行`
    })
    await sleep(Math.min(250, delay - elapsed))
  }
}

function hostCall(commandId, type, payload) {
  ensureNotCancelled(commandId)
  const id = `input-demo-${Date.now()}-${nextHostCall++}`
  send({ type, id, payload })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(Object.assign(new Error(`${type} timed out`), { code: 'REQUEST_TIMEOUT' }))
    }, 12000)
    timer.unref?.()
    pending.set(id, { resolve, reject, timer })
  })
}

async function keyboardTap(commandId, key, modifiers = []) {
  await hostCall(commandId, 'host.platform.input.keyboardTap', {
    key,
    modifiers
  })
}

async function runKeyboardTap(commandId, input) {
  const key = nonEmptyString(input.key, 'a')
  const modifiers = parseModifiers(input.modifiers)
  const repeat = Math.floor(clampNumber(input.repeat, 1, 20, 1))
  const intervalMs = clampNumber(input.intervalMs, 20, 2000, 120)
  await waitForStart(commandId, input.delayMs)

  for (let i = 0; i < repeat; i++) {
    ensureNotCancelled(commandId)
    await keyboardTap(commandId, key, modifiers)
    send({
      type: 'command.progress',
      id: commandId,
      progress: (i + 1) / repeat,
      message: `已发送 ${i + 1}/${repeat}: ${formatKey(key, modifiers)}`
    })
    if (i + 1 < repeat) await sleep(intervalMs)
  }

  return {
    action: 'keyboardTap',
    key,
    modifiers,
    repeat,
    finishedAt: Date.now()
  }
}

async function runTypeText(commandId, input) {
  const text = String(input.text ?? 'hello brickly 123')
  const intervalMs = clampNumber(input.intervalMs, 20, 1000, 80)
  await waitForStart(commandId, input.delayMs)

  const taps = [...text].map(charToTap)
  for (let i = 0; i < taps.length; i++) {
    ensureNotCancelled(commandId)
    const tap = taps[i]
    await keyboardTap(commandId, tap.key, tap.modifiers)
    send({
      type: 'command.progress',
      id: commandId,
      progress: (i + 1) / taps.length,
      message: `已输入 ${i + 1}/${taps.length}`
    })
    send({ type: 'command.chunk', id: commandId, chunk: tap.display })
    if (i + 1 < taps.length) await sleep(intervalMs)
  }

  return {
    action: 'typeText',
    text,
    chars: taps.length,
    finishedAt: Date.now()
  }
}

async function runMouseAction(commandId, input) {
  const action = nonEmptyString(input.action, 'move')
  const x = Math.round(clampNumber(input.x, -10000, 10000, 100))
  const y = Math.round(clampNumber(input.y, -10000, 10000, 100))
  await waitForStart(commandId, input.delayMs)

  const typeByAction = {
    move: 'host.platform.input.mouseMove',
    'left-click': 'host.platform.input.mouseClick',
    'double-click': 'host.platform.input.mouseDoubleClick',
    'right-click': 'host.platform.input.mouseRightClick'
  }
  const type = typeByAction[action]
  if (!type) {
    throw Object.assign(new Error(`未知鼠标动作: ${action}`), { code: 'INVALID_INPUT' })
  }
  await hostCall(commandId, type, { x, y })
  send({
    type: 'command.progress',
    id: commandId,
    progress: 1,
    message: `已执行 ${action} @ (${x}, ${y})`
  })
  return {
    action,
    x,
    y,
    finishedAt: Date.now()
  }
}

function charToTap(ch) {
  if (ch === ' ') return { key: 'space', modifiers: [], display: ' ' }
  if (ch === '\n') return { key: 'enter', modifiers: [], display: '\n' }
  if (ch === '\t') return { key: 'tab', modifiers: [], display: '\t' }
  if (/^[A-Z]$/.test(ch)) {
    return { key: ch.toLowerCase(), modifiers: ['shift'], display: ch }
  }
  return { key: ch, modifiers: [], display: ch }
}

function parseModifiers(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value ?? '')
    .split(/[,+\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function nonEmptyString(value, fallback) {
  const text = String(value ?? '').trim()
  return text || fallback
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function formatKey(key, modifiers) {
  return [...modifiers, key].join('+')
}

function ensureNotCancelled(commandId) {
  if (cancelled.has(commandId)) {
    throw Object.assign(new Error('已取消'), { code: 'CANCELLED' })
  }
}

function normalizeError(error) {
  if (error && error.code && error.message) {
    return { code: String(error.code), message: String(error.message), details: error.details }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error && error.message ? String(error.message) : String(error)
  }
}

async function handleInvoke(message) {
  const { id, commandId, input = {} } = message
  log('invoke start', { id, commandId })
  try {
    let result
    if (commandId === 'keyboard-tap') {
      result = await runKeyboardTap(id, input)
    } else if (commandId === 'type-text') {
      result = await runTypeText(id, input)
    } else if (commandId === 'mouse-action') {
      result = await runMouseAction(id, input)
    } else {
      throw Object.assign(new Error(`未知命令: ${commandId}`), { code: 'COMMAND_NOT_FOUND' })
    }
    send({ type: 'command.result', id, result })
    log('invoke result', { id, commandId })
  } catch (error) {
    send({ type: 'command.error', id, error: normalizeError(error) })
    log('invoke error', { id, commandId, error: normalizeError(error) })
  } finally {
    cancelled.delete(id)
  }
}

function resolveHostCall(message) {
  const item = pending.get(message.id)
  if (!item) return false
  clearTimeout(item.timer)
  pending.delete(message.id)
  if (message.type === 'host.result') {
    item.resolve(message.result)
  } else {
    item.reject(Object.assign(new Error(message.error?.message || 'host call failed'), {
      code: message.error?.code || 'INTERNAL_ERROR',
      details: message.error?.details
    }))
  }
  return true
}

function onMessage(message) {
  if (message.type === 'host.hello') {
    send({ type: 'runtime.ready', protocolVersion: PROTOCOL_VERSION, brickId: BRICK_ID })
  } else if (message.type === 'runtime.ping') {
    send({ type: 'runtime.pong', id: message.id })
  } else if (message.type === 'host.result' || message.type === 'host.error') {
    resolveHostCall(message)
  } else if (message.type === 'command.cancel') {
    cancelled.add(message.id)
  } else if (message.type === 'command.invoke') {
    void handleInvoke(message)
  } else if (message.type === 'runtime.shutdown') {
    send({ type: 'runtime.bye' })
    process.exit(0)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      onMessage(JSON.parse(line))
    } catch (error) {
      log('protocol parse failed', { error: String(error) })
    }
  }
})
