'use strict'

const DEFAULT_IDLE_MS = 1200

function textOf(input, fallback) {
  if (typeof input?.text === 'string' && input.text.trim()) return input.text.trim()
  return fallback
}

function delayMsOf(input, fallback = DEFAULT_IDLE_MS) {
  const value = Number(input?.delayMs)
  if (!Number.isFinite(value)) return fallback
  return Math.min(8000, Math.max(200, Math.round(value)))
}

function logLevels(log, ctxLog, input) {
  const text = textOf(input, 'hello log-lab')
  log.debug('command debug', { text, hide: '默认藏在「显示 Debug」里' })
  log.info('command brick.log.info', { text })
  log.warn('command brick.log.warn', { text })
  ctxLog.info('command ctx.log.info', { samePipe: true })
  return { ok: true, text, wrote: ['debug', 'info', 'warn', 'ctx.info'] }
}

function logErrorKeepSuccess(log) {
  log.error('command brick.log.error', { note: '这是日志行，不是第二次失败调用' })
  return { ok: true, status: 'success', note: '节点 status 应是成功' }
}

function failAfterLog(log) {
  log.warn('即将故意失败', { note: '这条仍应只在本节点日志栏' })
  const error = new Error('故意失败：看节点 status=failed，不要再出现一条失败顶级日志')
  error.code = 'INTERNAL_ERROR'
  throw error
}

async function streamFrames(send, log, count = 3) {
  log.info('开始推流式帧', { count })
  for (let index = 1; index <= count; index += 1) {
    await send({ type: 'progress', n: index, of: count })
  }
  return { ok: true, frames: count }
}

async function publishInCommand(publish, log, event = 'log-lab:probe') {
  log.info('命令内 publish', { event })
  await publish(event, { source: 'command', at: Date.now() })
  return { ok: true, event }
}

function scheduleIdleLog(log, input, wait = setTimeout) {
  const delayMs = delayMsOf(input)
  wait(() => {
    log.info('idle brick.log after command', {
      delayMs,
      note: '命令已结束：应出现在左侧顶级，不再进刚才那个节点'
    })
  }, delayMs)
  return { ok: true, scheduledMs: delayMs }
}

function stdoutInCommand(write, log) {
  log.info('接着写一行裸 stdout', { deprecated: true })
  write(`[com.brickly.log-lab] stdout inside command\n`)
  return { ok: true, channel: 'stdout' }
}

function scheduleStdout(write, input, wait = setTimeout) {
  const delayMs = delayMsOf(input)
  wait(() => {
    write(`[com.brickly.log-lab] stdout after command\n`)
  }, delayMs)
  return { ok: true, scheduledMs: delayMs, channel: 'stdout' }
}

async function callChild(invokeChild, log, input) {
  const text = textOf(input, 'hello from parent')
  log.info('即将调用子工具', { text })
  const child = await invokeChild({ text })
  log.info('子工具已返回', { child })
  return { ok: true, child }
}

module.exports = {
  DEFAULT_IDLE_MS,
  logLevels,
  logErrorKeepSuccess,
  failAfterLog,
  streamFrames,
  publishInCommand,
  scheduleIdleLog,
  stdoutInCommand,
  scheduleStdout,
  callChild
}
