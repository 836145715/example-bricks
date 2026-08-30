'use strict'

const { BppError, BricklyRuntime } = require('@syllm/brickly-sdk')
const {
  callChild,
  failAfterLog,
  logErrorKeepSuccess,
  logLevels,
  publishInCommand,
  scheduleIdleLog,
  scheduleStdout,
  stdoutInCommand,
  streamFrames
} = require('./scenarios.cjs')

const BRICK_ID = 'com.brickly.log-lab'
const brick = new BricklyRuntime()

brick.onCommand('log-levels', (ctx, input) => logLevels(brick.log, ctx.log, input))

brick.onCommand('log-error-keep-success', () => logErrorKeepSuccess(brick.log))

brick.onCommand('fail-after-log', () => {
  try {
    return failAfterLog(brick.log)
  } catch (error) {
    throw BppError.from(error)
  }
})

brick.onCommand('stream-frames', async (ctx, input) => {
  const count = Number(input?.count)
  return streamFrames((event) => ctx.send(event), brick.log, Number.isFinite(count) ? count : 3)
})

brick.onCommand('chat', async (ctx, input) => {
  brick.log.info('interact 已打开', { prompt: input?.prompt ?? null })
  ctx.onEvent(async (event) => {
    brick.log.info('收到 interact 帧', { event })
    await ctx.send({ type: 'echo', echo: event })
  })
  await ctx.closed
  return { ok: true }
})

brick.onCommand('publish-in-command', (ctx) =>
  publishInCommand((event, payload) => ctx.events.publish(event, payload), brick.log)
)

brick.onCommand('schedule-idle-log', (_ctx, input) => scheduleIdleLog(brick.log, input))

brick.onCommand('stdout-in-command', () => stdoutInCommand((text) => process.stdout.write(text), brick.log))

brick.onCommand('schedule-stdout', (_ctx, input) =>
  scheduleStdout((text) => process.stdout.write(text), input)
)

brick.onCommand('call-child', (ctx, input) =>
  callChild((payload) => ctx.dependencies.require('child').invoke('echo-log', payload), brick.log, input)
)

brick.onReady(() => {
  brick.log.info('log-lab ready', { note: '启动时没有当前 command：左侧顶级' })
  brick.events.publish('log-lab:ready', { at: Date.now() }).catch((error) => {
    brick.log.warn('ready 时 publish 失败', { error: error instanceof Error ? error.message : String(error) })
  })
})

brick.start()
