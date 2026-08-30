/* eslint-disable */
'use strict'

const { BppError, BricklyRuntime } = require('@syllm/brickly-sdk')
const { inspectPorts, inspectProcessDetails, killProcess, lookupPort, runtimeInfo } = require('./services/port-inspector.cjs')

const BRICK_ID = 'com.brickly.port-inspector'

const brick = new BricklyRuntime()

function normalizeError(error) {
  if (error instanceof BppError) return error
  if (error && error.code && error.message) {
    return new BppError(String(error.code), String(error.message), error.details)
  }
  return new BppError('INTERNAL_ERROR', error && error.message ? error.message : String(error))
}

brick.onCommand('lookup', async (ctx, input) => {
  try {
    const result = await lookupPort(input || {})
    return result
  } catch (error) {
    throw normalizeError(error)
  }
})

brick.onCommand('list', async (ctx, input) => {
  try {
    const result = await inspectPorts(input || {})
    return result
  } catch (error) {
    throw normalizeError(error)
  }
})

brick.onCommand('details', async (ctx, input) => {
  try {
    const result = await inspectProcessDetails(input || {})
    return result
  } catch (error) {
    throw normalizeError(error)
  }
})

brick.onCommand('kill', async (ctx, input) => {
  try {
    const result = await killProcess(input || {})
    return result
  } catch (error) {
    throw normalizeError(error)
  }
})

brick.onReady(() => {
  brick.log.info('ready', runtimeInfo())
})

brick.start()
