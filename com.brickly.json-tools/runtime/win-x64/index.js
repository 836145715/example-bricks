/* eslint-disable */
'use strict'

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

const brick = new BricklyRuntime()

function parseInput(input) {
  const raw = input && typeof input === 'object' && 'json' in input ? input.json : input
  if (typeof raw === 'string') return JSON.parse(raw)
  return raw
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

brick.onCommand('format', async (ctx, input) => {
  brick.log.info('command start', { commandId: 'format' })
  try {
    await ctx.send({ type: 'progress', progress: 0, message: 'parsing' })
    const value = parseInput(input)
    const formatted = JSON.stringify(value, null, 2)
    await ctx.send({ type: 'progress', progress: 0.5, message: 'streaming' })
    const step = Math.max(1, Math.ceil(formatted.length / 8))
    for (let i = 0; i < formatted.length; i += step) {
      if (ctx.signal.aborted || ctx.isCancelled()) throw new BppError('CANCELLED', 'Cancelled')
      await sleep(80)
      await ctx.send({ type: 'chunk', chunk: formatted.slice(i, i + step), name: 'formatted' })
    }
    await ctx.send({ type: 'progress', progress: 1, message: 'done' })
    brick.log.info('command result', { commandId: 'format', bytes: formatted.length })
    return formatted
  } catch (error) {
    if (error instanceof BppError) throw error
    throw new BppError('INVALID_INPUT', error && error.message ? error.message : String(error))
  }
})

brick.onCommand('minify', async (_ctx, input) => JSON.stringify(parseInput(input)))

brick.onCommand('parse', async (_ctx, input) => {
  const value = parseInput(input)
  return { type: Array.isArray(value) ? 'array' : typeof value, value }
})

brick.start()
