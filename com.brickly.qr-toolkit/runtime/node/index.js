/* eslint-disable */
'use strict'

/**
 * com.brickly.qr-toolkit — 二维码解析 / 生成
 */

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')
const { decodeQr } = require('./lib/decode')
const { generateQr } = require('./lib/generate')

const BRICK_ID = 'com.brickly.qr-toolkit'
const brick = new BricklyRuntime({ brickId: BRICK_ID })

function log(message, details) {
  try {
    brick.log.info(message, details)
  } catch (_) {
    /* ignore */
  }
}

brick.onCommand('decode', async (ctx, input) => {
  const id = ctx.requestId
  log('decode start', { id })
  try {
    const result = decodeQr(input || {})
    ctx.output('result', result)
    log('decode done', { id, ok: result.ok })
    return result
  } catch (error) {
    const code = (error && error.code) || 'DECODE_FAILED'
    const message = error && error.message ? error.message : String(error)
    log('decode error', { id, code, message })
    throw new BppError(code, message, error && error.details)
  }
})

brick.onCommand('generate', async (ctx, input) => {
  const id = ctx.requestId
  log('generate start', { id })
  try {
    const result = await generateQr(input || {})
    ctx.output('result', result)
    log('generate done', { id, ok: result.ok })
    return result
  } catch (error) {
    const code = (error && error.code) || 'GENERATE_FAILED'
    const message = error && error.message ? error.message : String(error)
    log('generate error', { id, code, message })
    throw new BppError(code, message, error && error.details)
  }
})

brick.onReady(() => {
  log('ready', { brickId: BRICK_ID })
})

brick.start()
