/* eslint-disable */
'use strict'

const { BppError, BricklyRuntime } = require('@syllm/brickly-sdk')
const { resolveDomain, resolveAllRecords, runtimeInfo } = require('./services/dns-resolver.cjs')

const BRICK_ID = 'com.brickly.dns-resolver'

const brick = new BricklyRuntime({ brickId: BRICK_ID })

function normalizeError(error) {
  if (error instanceof BppError) return error
  if (error && error.code && error.message) {
    return new BppError(String(error.code), String(error.message), error.details)
  }
  return new BppError('INTERNAL_ERROR', error && error.message ? error.message : String(error))
}

brick.onCommand('resolve', async (ctx, input) => {
  try {
    const result = await resolveDomain(input || {})
    ctx.output('result', result)
    return result
  } catch (error) {
    throw normalizeError(error)
  }
})

brick.onCommand('resolve-all', async (ctx, input) => {
  try {
    const result = await resolveAllRecords(input || {})
    ctx.output('result', result)
    return result
  } catch (error) {
    throw normalizeError(error)
  }
})

brick.onReady(() => {
  brick.transport.log('ready', runtimeInfo())
})

brick.start()
