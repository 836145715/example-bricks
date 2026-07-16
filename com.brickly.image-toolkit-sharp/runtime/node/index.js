/* eslint-disable */
'use strict'

/**
 * com.brickly.image-toolkit-sharp — 后端图像处理引擎
 *
 * 基于 JSON-Lines over stdin/stdout (BPP 协议 0.1.0)。
 * 命令 process-image → lib/batch.runProcessImage，结果为 items/summary 契约。
 */

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')
const { runProcessImage } = require('./lib/batch')

const BRICK_ID = 'com.brickly.image-toolkit-sharp'
const brick = new BricklyRuntime({ brickId: BRICK_ID })

/** @type {Set<string>} */
const cancelled = new Set()

function log (message, details) {
  brick.log.info(message, details)
}

/**
 * process-image handler: progress/cancel wired into batch dispatcher.
 * @param {import('@syllm/brickly-sdk').CommandContext} ctx
 * @param {object} input
 */
async function handleProcessImage (ctx, input) {
  const id = ctx.requestId
  log('开始调用', { id, commandId: 'process-image' })

  ctx.onCancel(() => {
    log('收到取消指令', { id })
    cancelled.add(id)
  })

  try {
    const previewOnly = !!(input && (input.previewOnly || (input.common && input.common.previewOnly)))
    const result = await runProcessImage({
      action: input && input.action,
      files: input && input.files,
      options: (input && input.options) || {},
      output: (input && input.output) || {},
      common: (input && input.common) || {},
      previewOnly,
      onProgress: (p, message) => {
        try {
          ctx.progress(p, message)
        } catch (_) {
          /* host may have disconnected */
        }
      },
      isCancelled: () => cancelled.has(id)
    })
    log('调用完成', {
      id,
      total: result.summary.total,
      succeeded: result.summary.succeeded,
      failed: result.summary.failed,
      previewOnly: !!result.summary.previewOnly
    })
    return result
  } catch (error) {
    const code = (error && error.code) || 'RUNTIME_ERROR'
    const message = error && error.message ? error.message : String(error)
    log('调用出错', { id, code, message })
    throw new BppError(code, message, error && error.details)
  } finally {
    cancelled.delete(id)
    log('调用结束', { id, commandId: 'process-image' })
  }
}

brick.onCommand('process-image', handleProcessImage)

brick.onShutdown(() => {
  log('收到停机指令')
})

brick.start()

process.on('uncaughtException', (e) => {
  brick.log.error('发生未捕获异常 uncaughtException', e, {
    message: e.message,
    stack: e.stack
  })
})
