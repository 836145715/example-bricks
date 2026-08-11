const assert = require('node:assert/strict')
const test = require('node:test')

const { GROUPS, TEST_STATUS, catalog, selectScenarios } = require('./catalog.cjs')
const { createResult, sanitizeError, sanitizeResourceRef } = require('./contracts.cjs')

test('场景目录覆盖全部资源分组且 id 唯一', () => {
  assert.deepEqual(GROUPS, ['create', 'read', 'cross-language', 'lifecycle', 'stress'])
  assert.deepEqual(TEST_STATUS, [
    'pending',
    'running',
    'passed',
    'failed',
    'skipped',
    'cancelled',
    'waiting-restart'
  ])
  assert.ok(catalog.length >= 25)
  assert.equal(new Set(catalog.map((scenario) => scenario.id)).size, catalog.length)
  assert.deepEqual(new Set(catalog.map((scenario) => scenario.group)), new Set(GROUPS))
})

test('默认套件不包含超过 64 MiB 或压力专属场景', () => {
  const defaults = selectScenarios({ mode: 'default' })
  assert.ok(defaults.length > 0)
  assert.equal(defaults.some((scenario) => scenario.mode === 'stress'), false)
  assert.equal(defaults.some((scenario) => scenario.requirements?.includes('restart')), false)
  assert.equal(defaults.some((scenario) => (scenario.sizeBytes ?? 0) > 64 * 1024 * 1024), false)

  const stress = selectScenarios({ mode: 'stress' })
  assert.ok(stress.some((scenario) => scenario.sizeBytes === 201 * 1024 * 1024))
  assert.ok(stress.some((scenario) => scenario.sizeBytes === 1024 * 1024 * 1024))
  assert.ok(stress.every((scenario) => scenario.mode === 'stress'))
  assert.equal(stress.some((scenario) => scenario.requirements?.includes('restart')), false)

  const restart = catalog.find((scenario) => scenario.id === 'restart-runtime-recovery')
  assert.equal(restart.mode, 'manual')
})

test('可以按场景 id 精确选择并拒绝未知 id', () => {
  assert.deepEqual(selectScenarios({ ids: ['create-empty', 'read-json'] }).map((item) => item.id), [
    'create-empty',
    'read-json'
  ])
  assert.throws(() => selectScenarios({ ids: ['missing'] }), /未知测试场景/)
})

test('ResourceRef、错误和结果 DTO 不泄露能力令牌与内容', () => {
  const ref = sanitizeResourceRef({
    kind: 'brickly.resource',
    resourceId: 'res_1',
    accessToken: 'secret-token',
    sizeBytes: 12,
    mimeType: 'text/plain',
    filePath: 'C:\\secret\\resource.bin',
    content: 'secret-content',
    chunk: 'base64-secret'
  })
  assert.deepEqual(ref, {
    kind: 'brickly.resource',
    resourceId: 'res_1',
    sizeBytes: 12,
    mimeType: 'text/plain'
  })

  const error = new Error('failed with secret-token and C:\\secret\\resource.bin')
  error.code = 'RESOURCE_EXPIRED'
  const safeError = sanitizeError(error)
  assert.equal(safeError.code, 'RESOURCE_EXPIRED')
  assert.equal(safeError.message.includes('secret-token'), false)
  assert.equal(safeError.message.includes('C:\\secret'), false)

  const result = createResult(catalog[0], 'run_1')
  assert.equal(result.runId, 'run_1')
  assert.equal(result.status, 'pending')
  assert.equal(result.scenarioId, catalog[0].id)
  assert.equal('accessToken' in JSON.parse(JSON.stringify(result)), false)
})
