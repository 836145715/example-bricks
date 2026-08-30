'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
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

function collectLog() {
  const calls = []
  return {
    calls,
    log: {
      debug: (message, fields) => calls.push(['debug', message, fields]),
      info: (message, fields) => calls.push(['info', message, fields]),
      warn: (message, fields) => calls.push(['warn', message, fields]),
      error: (message, fields) => calls.push(['error', message, fields])
    }
  }
}

test('log-levels 同时打 brick.log 与 ctx.log', () => {
  const brick = collectLog()
  const ctx = collectLog()
  const result = logLevels(brick.log, ctx.log, { text: 'demo' })
  assert.equal(result.ok, true)
  assert.ok(brick.calls.some((item) => item[0] === 'info' && item[1] === 'command brick.log.info'))
  assert.ok(ctx.calls.some((item) => item[1] === 'command ctx.log.info'))
})

test('log.error 仍返回成功', () => {
  const brick = collectLog()
  const result = logErrorKeepSuccess(brick.log)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'success')
  assert.equal(brick.calls[0][0], 'error')
})

test('fail-after-log 先打日志再抛错', () => {
  const brick = collectLog()
  assert.throws(() => failAfterLog(brick.log), /故意失败/)
  assert.ok(brick.calls.some((item) => item[0] === 'warn'))
})

test('stream-frames 按序 send', async () => {
  const sent = []
  const brick = collectLog()
  const result = await streamFrames((event) => sent.push(event), brick.log, 3)
  assert.deepEqual(sent, [
    { type: 'progress', n: 1, of: 3 },
    { type: 'progress', n: 2, of: 3 },
    { type: 'progress', n: 3, of: 3 }
  ])
  assert.equal(result.frames, 3)
})

test('publish-in-command 走传入的 publish', async () => {
  const published = []
  const brick = collectLog()
  await publishInCommand((event, payload) => published.push({ event, payload }), brick.log)
  assert.equal(published[0].event, 'log-lab:probe')
})

test('schedule-idle-log 在 delay 后才打顶级日志', async () => {
  const brick = collectLog()
  const timers = []
  const result = scheduleIdleLog(brick.log, { delayMs: 500 }, (fn, ms) => {
    timers.push({ fn, ms })
  })
  assert.equal(result.scheduledMs, 500)
  assert.equal(brick.calls.length, 0)
  timers[0].fn()
  assert.ok(brick.calls.some((item) => item[1] === 'idle brick.log after command'))
})

test('stdout-in-command 写裸 stdout', () => {
  const chunks = []
  const brick = collectLog()
  stdoutInCommand((text) => chunks.push(text), brick.log)
  assert.match(chunks.join(''), /stdout inside command/)
})

test('schedule-stdout 延后写 stdout', () => {
  const chunks = []
  const timers = []
  scheduleStdout((text) => chunks.push(text), { delayMs: 300 }, (fn) => timers.push(fn))
  assert.equal(chunks.length, 0)
  timers[0]()
  assert.match(chunks.join(''), /stdout after command/)
})

test('call-child 先记父日志再调子工具', async () => {
  const brick = collectLog()
  const result = await callChild(async (payload) => ({ echo: payload.text }), brick.log, {
    text: 'ping'
  })
  assert.equal(result.child.echo, 'ping')
  assert.ok(brick.calls.some((item) => item[1] === '即将调用子工具'))
})
