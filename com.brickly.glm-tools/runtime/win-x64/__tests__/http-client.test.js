/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { extractApiError } = require('../src/http-client')
const { resolveApiKey, resolveBaseUrl } = require('../src/glm-client')

test('extractApiError 兼容 BigModel error 包装', () => {
  assert.deepEqual(extractApiError(400, { error: { code: '1001', message: 'bad request' } }), {
    code: '1001',
    message: 'bad request'
  })
})

test('resolveApiKey 支持 Profile 和常见环境变量', () => {
  assert.equal(resolveApiKey({ apiKey: 'from-profile' }, {}), 'from-profile')
  assert.equal(resolveApiKey({}, { BIGMODEL_API_KEY: 'from-env' }), 'from-env')
  assert.equal(resolveApiKey({}, { ZHIPUAI_API_KEY: 'from-zhipu' }), 'from-zhipu')
})

test('resolveBaseUrl 使用官方默认地址', () => {
  assert.equal(resolveBaseUrl({}, {}), 'https://open.bigmodel.cn/api')
  assert.equal(resolveBaseUrl({ baseUrl: 'https://proxy.example.com/api' }, {}), 'https://proxy.example.com/api')
})
