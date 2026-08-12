'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { getInputResourceRef, openInputResource } = require('./resource-input.cjs')

test('普通命令输入通过 resources.open 显式打开 ResourceRef', () => {
  const ref = { kind: 'brickly.resource', resourceId: 'res_node', accessToken: 'token' }
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
  const ref = { kind: 'brickly.resource', resourceId: 'res_relay', accessToken: 'token' }
  assert.equal(getInputResourceRef({ resource: ref }), ref)
})
