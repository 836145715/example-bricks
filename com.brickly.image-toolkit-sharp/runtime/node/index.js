/* eslint-disable */
'use strict'

/**
 * com.brickly.image-toolkit-sharp — 后端图像处理引擎
 *
 * 基于 JSON-Lines over stdin/stdout (BPP 协议 0.1.0)。
 * 核心依赖：sharp 库。
 * 实现功能：压缩、转换、尺寸、水印、圆角、补边、裁剪、旋转、翻转、图片合并、PDF合并、GIF合并。
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')
const { loadSharp } = require('./lib/sharp-loader')
const { compileJpegsToPdf } = require('./lib/pdf-compile')
const { escapeXml } = require('./lib/svg-escape')
const { getAction } = require('./actions')

const BRICK_ID = 'com.brickly.image-toolkit-sharp'
const brick = new BricklyRuntime({ brickId: BRICK_ID })

const cancelled = new Set()
const activeCommands = new Map()

function send(message) {
  const active = activeCommands.get(message.id)
  if (!active) return
  if (message.type === 'command.progress') {
    active.ctx.progress(message.progress, message.message)
  } else if (message.type === 'command.chunk') {
    active.ctx.chunk(message.chunk, message.name)
  } else if (message.type === 'command.output') {
    active.ctx.output(message.name, message.value)
  } else if (message.type === 'command.result') {
    active.result = message.result
  } else if (message.type === 'command.error') {
    active.error = new BppError(
      message.error?.code || 'INTERNAL_ERROR',
      message.error?.message || 'Runtime error',
      message.error?.details
    )
  }
}

function log(message, details) {
  brick.log.info(message, details)
}

function ensureNotCancelled(id) {
  if (cancelled.has(id)) {
    const err = new Error('Cancelled by host')
    err.code = 'CANCELLED'
    throw err
  }
}

// ----------------------------------------------------------------------------
// 图像处理核心功能分发（ACTION_MAP；单文件 primaryFile 路径，完整 batch 留给任务4）
// ----------------------------------------------------------------------------

async function cmdProcessImage(id, input) {
  const sharp = loadSharp()
  const { action, files, options = {}, outputPath } = input || {}

  if (!action) throw new Error('action 必填')
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new Error('files 数组不能为空')
  }

  const actionMod = getAction(action)
  if (!actionMod) {
    throw new Error(`不支持的操作 action: ${action}`)
  }

  // 解析得到第一个主文件，很多单图操作使用它
  const primaryFile = files[0]
  await fs.access(primaryFile) // 检查输入文件是否存在

  // 确定最终输出路径。如果不提供，默认在原文件同目录下加 Action 后缀
  let finalOutPath = outputPath
  if (!finalOutPath) {
    const parsed = path.parse(primaryFile)
    let ext = action === 'pdf' ? '.pdf' : action === 'gif' ? '.gif' : parsed.ext
    // 如果转换格式，采用目标格式的后缀
    if (action === 'convert' && options.format) {
      ext = `.${options.format}`
    }
    finalOutPath = path.join(parsed.dir, `${parsed.name}_${action}_processed${ext}`)
  }

  // 确保输出目录存在
  await fs.mkdir(path.dirname(finalOutPath), { recursive: true })

  send({ type: 'command.progress', id, progress: 0.1, message: '初始化处理' })
  ensureNotCancelled(id)

  send({ type: 'command.progress', id, progress: 0.4, message: `执行 ${actionMod.id}` })

  const actionResult = await actionMod.run({
    inputPath: primaryFile,
    files,
    options,
    outputPath: finalOutPath,
    loadSharp,
    escapeXml,
    compileJpegsToPdf,
    ensureNotCancelled: () => ensureNotCancelled(id)
  })

  if (!actionResult || !actionResult.type) {
    throw new Error(`Action ${actionMod.id} returned invalid result`)
  }

  if (actionResult.type === 'pipeline') {
    await actionResult.pipeline.toFile(finalOutPath)
  } else if (actionResult.type === 'buffer') {
    await fs.writeFile(finalOutPath, actionResult.buffer)
  } else if (actionResult.type === 'written') {
    // already on disk (pdf etc.)
    finalOutPath = actionResult.outputPath || finalOutPath
  } else {
    throw new Error(`Action ${actionMod.id} returned unknown type: ${actionResult.type}`)
  }

  send({ type: 'command.progress', id, progress: 0.9, message: '收尾处理中' })
  ensureNotCancelled(id)

  const finalStat = await fs.stat(finalOutPath)
  // PDF 不是 sharp 可读图像；metadata 失败时回退
  const finalMeta = await sharp(finalOutPath).metadata().catch(() => ({}))

  const resultInfo = {
    outputPath: finalOutPath,
    sizeBytes: finalStat.size,
    sizeKb: Math.round((finalStat.size / 1024) * 100) / 100,
    width: finalMeta.width || null,
    height: finalMeta.height || null,
    format: finalMeta.format || action
  }

  send({ type: 'command.progress', id, progress: 1, message: '完成' })
  send({
    type: 'command.result',
    id,
    result: resultInfo
  })
}

// ----------------------------------------------------------------------------
// SDK 命令分发器
// ----------------------------------------------------------------------------

async function handleInvoke(message) {
  const { id, commandId, input } = message
  log('开始调用', { id, commandId })
  try {
    if (commandId === 'process-image') {
      return await cmdProcessImage(id, input)
    }

    send({
      type: 'command.error',
      id,
      error: { code: 'COMMAND_NOT_FOUND', message: `未知的命令: ${commandId}` }
    })
  } catch (error) {
    const code = (error && error.code) || 'RUNTIME_ERROR'
    log('调用出错', { id, commandId, code, message: error && error.message })
    send({
      type: 'command.error',
      id,
      error: { code, message: error && error.message ? error.message : String(error) }
    })
  } finally {
    cancelled.delete(id)
    log('调用结束', { id, commandId })
  }
}

async function runWithSdk(ctx, input) {
  const active = { ctx, result: undefined, error: undefined }
  activeCommands.set(ctx.requestId, active)
  ctx.onCancel(() => {
    log('收到取消指令', { id: ctx.requestId })
    cancelled.add(ctx.requestId)
  })
  try {
    await handleInvoke({ id: ctx.requestId, commandId: ctx.commandId, input })
    if (active.error) throw active.error
    return active.result
  } finally {
    activeCommands.delete(ctx.requestId)
  }
}

brick.onCommand('process-image', runWithSdk)

brick.onShutdown(() => {
  log('收到停机指令')
})

brick.start()

process.on('uncaughtException', (e) => {
  brick.log.error('发生未捕获异常 uncaughtException', e, { message: e.message, stack: e.stack })
})
