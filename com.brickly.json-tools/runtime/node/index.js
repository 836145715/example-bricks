/* eslint-disable */
'use strict'

let buffer = ''
const cancelled = new Set()

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function log(message, details) {
  process.stderr.write(`[json-tools] ${message}${details ? ` ${JSON.stringify(details)}` : ''}\n`)
}

function parseInput(input) {
  const raw = input && typeof input === 'object' && 'json' in input ? input.json : input
  if (typeof raw === 'string') return JSON.parse(raw)
  return raw
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handleInvoke(message) {
  const { id, commandId, input } = message
  log('invoke start', { id, commandId })
  try {
    if (commandId === 'format') {
      send({ type: 'command.progress', id, progress: 0, message: 'parsing' })
      const value = parseInput(input)
      const formatted = JSON.stringify(value, null, 2)
      send({ type: 'command.progress', id, progress: 0.5, message: 'streaming' })
      const step = Math.max(1, Math.ceil(formatted.length / 8))
      for (let i = 0; i < formatted.length; i += step) {
        if (cancelled.has(id)) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })
        await sleep(80)
        send({ type: 'command.chunk', id, chunk: formatted.slice(i, i + step) })
      }
      send({ type: 'command.progress', id, progress: 1, message: 'done' })
      send({ type: 'command.result', id, result: formatted })
      log('invoke result', { id, commandId, bytes: formatted.length })
      return
    }
    if (commandId === 'minify') {
      const value = parseInput(input)
      send({ type: 'command.result', id, result: JSON.stringify(value) })
      log('invoke result', { id, commandId })
      return
    }
    if (commandId === 'parse') {
      const value = parseInput(input)
      send({
        type: 'command.result',
        id,
        result: { type: Array.isArray(value) ? 'array' : typeof value, value }
      })
      log('invoke result', { id, commandId })
      return
    }
    send({
      type: 'command.error',
      id,
      error: { code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${commandId}` }
    })
  } catch (error) {
    const code = error && error.code ? error.code : 'INVALID_INPUT'
    log('invoke error', {
      id,
      commandId,
      code,
      message: error && error.message ? error.message : String(error)
    })
    send({
      type: 'command.error',
      id,
      error: { code, message: error && error.message ? error.message : String(error) }
    })
  } finally {
    log('invoke finish', { id, commandId, cancelled: cancelled.has(id) })
    cancelled.delete(id)
  }
}

function onMessage(message) {
  if (message.type === 'host.hello') {
    log('host hello')
    send({ type: 'runtime.ready', protocolVersion: '0.1.0', brickId: 'com.brickly.json-tools' })
  } else if (message.type === 'runtime.ping') {
    send({ type: 'runtime.pong', id: message.id })
  } else if (message.type === 'command.cancel') {
    log('cancel received', { id: message.id })
    cancelled.add(message.id)
  } else if (message.type === 'command.invoke') {
    handleInvoke(message)
  } else if (message.type === 'runtime.shutdown') {
    log('shutdown')
    send({ type: 'runtime.bye' })
    process.exit(0)
  }
}

process.stdin.setEncoding('utf8')
process.stdout.setDefaultEncoding?.('utf8')
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
        error: { code: 'PROTOCOL_ERROR', message: error.message }
      })
    }
  }
})
