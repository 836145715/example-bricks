'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.log-lab-child'
const brick = new BricklyRuntime()

brick.onCommand('echo-log', (ctx, input) => {
  const text = typeof input?.text === 'string' && input.text.trim() ? input.text.trim() : 'hello from child'
  brick.log.info('child brick.log.info', { text, layer: 'child-node' })
  ctx.log.warn('child ctx.log.warn', { note: '应只出现在子节点日志栏' })
  return { ok: true, brickId: BRICK_ID, text }
})

brick.onReady(() => {
  brick.log.info('child runtime ready', { note: '无当前命令：左侧顶级' })
})

brick.start()
