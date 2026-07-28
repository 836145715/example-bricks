/* eslint-disable */
'use strict'

const { BppError, BricklyRuntime } = require('@syllm/brickly-sdk')
const { sendHttpRequest, ClientError } = require('./services/http-client.cjs')

const BRICK_ID = 'com.brickly.http-tester'
const brick = new BricklyRuntime({ brickId: BRICK_ID })

function normalizeError(error) {
  if (error instanceof BppError) return error
  if (error instanceof ClientError) {
    return new BppError(error.code, error.message, error.details)
  }
  if (error && error.code && error.message) {
    return new BppError(String(error.code), String(error.message), error.details)
  }
  return new BppError('INTERNAL_ERROR', error && error.message ? error.message : String(error))
}

brick.onCommand('send', async (ctx, input) => {
  try {
    const result = await sendHttpRequest(input || {})
    const host = (() => {
      try { return new URL(String((input && input.url) || '')).host } catch { return '?' }
    })()
    brick.log.info('send', {
      method: String((input && input.method) || 'GET').toUpperCase(),
      host,
      status: result.status,
      durationMs: result.durationMs
    })
    ctx.output('result', result)
    return result
  } catch (error) {
    throw normalizeError(error)
  }
})

brick.onReady(() => {
  brick.log.info('ready', { brickId: BRICK_ID })
})

brick.start()
