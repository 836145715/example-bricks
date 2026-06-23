/* eslint-disable */
'use strict'

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

const brick = new BricklyRuntime({ brickId: 'com.brickly.json-tools' })

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

brick.onCommand('format', async (ctx, input) => {
  log('invoke start', { id: ctx.requestId, commandId: ctx.commandId })
  try {
    ctx.progress(0, 'parsing')
    const value = parseInput(input)
    const formatted = JSON.stringify(value, null, 2)
    ctx.progress(0.5, 'streaming')
    const step = Math.max(1, Math.ceil(formatted.length / 8))
    for (let i = 0; i < formatted.length; i += step) {
      if (ctx.isCancelled()) throw new BppError('CANCELLED', 'Cancelled')
      await sleep(80)
      ctx.chunk(formatted.slice(i, i + step))
    }
    ctx.progress(1, 'done')
    log('invoke result', { id: ctx.requestId, commandId: ctx.commandId, bytes: formatted.length })
    return formatted
  } catch (error) {
    if (error instanceof BppError) throw error
    throw new BppError('INVALID_INPUT', error && error.message ? error.message : String(error))
  } finally {
    log('invoke finish', { id: ctx.requestId, commandId: ctx.commandId, cancelled: ctx.isCancelled() })
  }
})

brick.onCommand('minify', async (_ctx, input) => JSON.stringify(parseInput(input)))

brick.onCommand('parse', async (_ctx, input) => {
  const value = parseInput(input)
  return { type: Array.isArray(value) ? 'array' : typeof value, value }
})

brick.start()
