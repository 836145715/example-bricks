'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { HoldRegistry } = require('./hold-registry.cjs')

test('HoldRegistry 按 operationId 中止并释放慢速读取', () => {
  const registry = new HoldRegistry()
  const signal = registry.begin('operation-a')
  assert.equal(signal.aborted, false)
  assert.equal(registry.cancel('operation-a'), true)
  assert.equal(signal.aborted, true)
  registry.end('operation-a')
  assert.equal(registry.cancel('operation-a'), false)
})

test('HoldRegistry 拒绝重复 operationId', () => {
  const registry = new HoldRegistry()
  registry.begin('operation-a')
  assert.throws(() => registry.begin('operation-a'), { code: 'INVALID_INPUT' })
})
