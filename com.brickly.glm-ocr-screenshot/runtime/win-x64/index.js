/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')
const { captureAnnotate, captureText } = require('./src/command')
const { normalizeError } = require('./src/errors')
const { withHotkeyDefaults } = require('./src/hotkey')

const BRICK_ID = 'com.brickly.glm-ocr-screenshot'

const plugin = new BricklyRuntime({ brickId: BRICK_ID })

plugin.onCommand('capture-annotate', async (ctx, input) => {
  try {
    return await captureAnnotate(ctx, withHotkeyDefaults(ctx, input))
  } catch (error) {
    throw normalizeError(error)
  }
})

plugin.onCommand('capture-text', async (ctx, input) => {
  try {
    return await captureText(ctx, withHotkeyDefaults(ctx, input))
  } catch (error) {
    throw normalizeError(error)
  }
})

plugin.start()
