'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { getInputResourceRef, openInputResource } = require('./resource-input.cjs')

test('普通命令输入通过 resources.open 显式打开 ResourceRef', () => {
  const ref = { kind: 'brickly.resource', resourceId: 'res_node' }
  const handle = { ref }
  const calls = []
  const result = openInputResource({ open(value) { calls.push(value); return handle } }, { resource: ref })
  assert.equal(result, handle)
  assert.deepEqual(calls, [ref])
})

test('缺少 resource 的普通命令输入在调用 SDK 前失败', () => {
  assert.throws(() => openInputResource({ open() { throw new Error('unreachable') } }, {}), {
    code: 'INVALID_INPUT'
  })
})

test('跨 Brick 转发只提取 ResourceRef，不提前打开资源', () => {
  const ref = { kind: 'brickly.resource', resourceId: 'res_relay' }
  assert.equal(getInputResourceRef({ resource: ref }), ref)
})

test('已是 Handle 的输入不再二次 open', () => {
  const handle = { stream() {}, ref: { kind: 'brickly.resource', resourceId: 'res_handle' } }
  const calls = []
  assert.equal(
    openInputResource({ open(value) { calls.push(value); return value } }, { resource: handle }),
    handle
  )
  assert.deepEqual(calls, [])
})

test('事件业务对象里的 resource 字段按 ResourceRef 打开', () => {
  const ref = { kind: 'brickly.resource', resourceId: 'res_event' }
  const handle = { ref }
  const calls = []
  const { openEventPayload } = require('./resource-input.cjs')
  assert.equal(
    openEventPayload({ open(value) { calls.push(value); return handle } }, { probeId: 'p1', resource: ref }),
    handle
  )
  assert.deepEqual(calls, [ref])
})
