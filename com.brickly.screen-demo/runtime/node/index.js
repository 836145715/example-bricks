/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const brick = new BricklyRuntime({ brickId: 'com.brickly.screen-demo' })

function normalizeTimeout(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 120000
  return Math.max(1000, Math.min(300000, Math.round(n)))
}

brick.onCommand('pick-color', async (ctx, input = {}) => {
  const color = await ctx.platform.screen.pickColor({ timeoutMs: normalizeTimeout(input.timeoutMs) })
  ctx.output('color', color)
  return color
})

brick.onCommand('capture-region', async (ctx, input = {}) => {
  const result = await ctx.platform.screen.captureRegion({
    format: 'dataUrl',
    timeoutMs: normalizeTimeout(input.timeoutMs)
  })
  const capture = {
    kind: 'image',
    name: 'screen-capture.png',
    mimeType: result.mimeType,
    size: result.size,
    createdAt: result.createdAt,
    dataUrl: result.dataUrl
  }
  ctx.output('capture', capture)
  return capture
})

brick.start()
