/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')
const commands = require('./src/commands')
const { normalizeError } = require('./src/errors')

const BRICK_ID = 'com.brickly.glm-tools'

const plugin = new BricklyRuntime({ brickId: BRICK_ID })

function register(commandId, handler) {
  plugin.onCommand(commandId, async (ctx, input) => {
    try {
      return await handler(ctx, input || {})
    } catch (error) {
      throw normalizeError(error)
    }
  })
}

register('web-search', commands.webSearch)
register('reader', commands.reader)
register('moderate-content', commands.moderateContent)
register('parse-file-sync', commands.parseFileSync)
register('create-file-parse-task', commands.createFileParseTask)
register('get-file-parse-result', commands.getFileParseResult)
register('ocr', commands.ocr)

plugin.start()
