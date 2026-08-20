/* eslint-disable */
'use strict'

/**
 * 内网文件共享 Brick runtime。
 *
 * 作为常驻 service：UI 通过 window.brickly.invoke 调用以下命令控制共享服务，
 * runtime 负责启停 HTTP 文件服务、持久化配置并回传状态与传输日志。
 */

const os = require('node:os')
const path = require('node:path')
const { BppError, BricklyRuntime } = require('@syllm/brickly-sdk')

const { ShareService } = require('./services/share-service.cjs')

const BRICK_ID = 'com.brickly.lan-share'
const DATA_DIR = path.join(os.homedir(), '.brickly', 'apps', BRICK_ID)

const brick = new BricklyRuntime({ brickId: BRICK_ID })
const service = new ShareService({
  dataDir: DATA_DIR,
  log: (message) => brick.log.info(`[${BRICK_ID}] ${message}`)
})

function normalizeError(error) {
  if (error instanceof BppError) return error
  const code = error && error.code ? String(error.code) : 'INTERNAL_ERROR'
  const message = error && error.message ? error.message : String(error)
  return new BppError(code, message)
}

/** 统一包装：执行业务逻辑、写入声明的 output、返回裸值，并归一化错误。 */
function handle(outputName, run) {
  return async (ctx, input) => {
    try {
      const value = await run(ctx, input || {})
      ctx.output(outputName, value)
      return value
    } catch (error) {
      throw normalizeError(error)
    }
  }
}

brick.onCommand('status', handle('status', () => service.status()))

brick.onCommand('start', handle('status', (_ctx, input) => service.start(input)))

brick.onCommand('stop', handle('status', () => service.stop()))

brick.onCommand(
  'update-config',
  handle('config', async (_ctx, input) => {
    const config = await service.updateConfig(input)
    // 不回传访问码明文，仅告知是否已设置。
    return {
      root: config.root,
      port: config.port,
      allowUpload: config.allowUpload,
      hasAccessCode: Boolean(config.accessCode)
    }
  })
)

brick.onCommand('default-root', handle('root', () => service.defaultRoot()))

brick.onCommand(
  'list-entries',
  handle('result', (_ctx, input) => service.listEntries(input.subPath || ''))
)

brick.onCommand(
  'clear-log',
  handle('ok', () => {
    service.clearLog()
    return { ok: true }
  })
)

brick.onCommand(
  'open-folder',
  handle('ok', async (_ctx, input) => {
    const target = (input.path && String(input.path)) || service.status().root
    await brick.platform.system.shellOpenPath(target)
    return { ok: true }
  })
)

brick.onCommand(
  'open-url',
  handle('ok', async (_ctx, input) => {
    const url = input.url ? String(input.url) : ''
    if (!url) throw new BppError('INVALID_INPUT', '缺少 url')
    await brick.platform.system.shellOpenExternal(url)
    return { ok: true }
  })
)

brick.onReady(async () => {
  await service.loadConfig()
  brick.log.info(`[${BRICK_ID}] ready · dataDir=${DATA_DIR}`)
})

brick.onShutdown(async () => {
  await service.stop().catch(() => {})
})

brick.start()
