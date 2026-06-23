/* eslint-disable */
'use strict'

const BRICK_ID = 'com.brickly.screen-demo'
const PROTOCOL_VERSION = '0.1.0'
const HOST_CALL_TIMEOUT_MS = 180000

let buffer = ''
let nextHostCall = 1
const pending = new Map()

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function hostCall(type, payload = {}) {
  const id = `screen-demo-${Date.now()}-${nextHostCall++}`
  send({ type, id, ...payload })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(Object.assign(new Error(`${type} timed out`), { code: 'REQUEST_TIMEOUT' }))
    }, HOST_CALL_TIMEOUT_MS)
    timer.unref?.()
    pending.set(id, { resolve, reject, timer })
  })
}

async function pickColor(input) {
  return hostCall('host.platform.screen.pickColor', {
    options: { timeoutMs: normalizeTimeout(input.timeoutMs) }
  })
}

async function captureRegion(input) {
  const result = await hostCall('host.platform.screen.captureRegion', {
    options: {
      format: 'dataUrl',
      timeoutMs: normalizeTimeout(input.timeoutMs)
    }
  })

  return {
    kind: 'image',
    name: 'screen-capture.png',
    mimeType: result.mimeType,
    size: result.size,
    createdAt: result.createdAt,
    dataUrl: result.dataUrl
  }
}

async function handleInvoke(message) {
  const { id, commandId, input = {} } = message
  try {
    if (commandId === 'pick-color') {
      const color = await pickColor(input)
      send({ type: 'command.output', id, name: 'color', value: color })
      send({ type: 'command.result', id, result: color })
      return
    }

    if (commandId === 'capture-region') {
      const capture = await captureRegion(input)
      send({ type: 'command.output', id, name: 'capture', value: capture })
      send({ type: 'command.result', id, result: capture })
      return
    }

    send({
      type: 'command.error',
      id,
      error: { code: 'COMMAND_NOT_FOUND', message: `未知命令: ${commandId}` }
    })
  } catch (error) {
    send({ type: 'command.error', id, error: normalizeError(error) })
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
    item.reject(
      Object.assign(new Error(message.error?.message || 'host call failed'), {
        code: message.error?.code || 'INTERNAL_ERROR',
        details: message.error?.details
      })
    )
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
  } else if (message.type === 'command.invoke') {
    void handleInvoke(message)
  } else if (message.type === 'runtime.shutdown') {
    send({ type: 'runtime.bye' })
    process.exit(0)
  }
}

function normalizeTimeout(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 120000
  return Math.max(1000, Math.min(300000, Math.round(n)))
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
      send({
        type: 'command.error',
        id: 'unknown',
        error: normalizeError(error)
      })
    }
  }
})
