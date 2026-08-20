/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildModerationRequest,
  buildOcrFields,
  buildParserFields,
  buildParserResultPath,
  buildReaderRequest,
  buildWebSearchRequest
} = require('../src/request-builders')
const commands = require('../src/commands')

test('buildWebSearchRequest 映射 camelCase 输入到 BigModel 字段', () => {
  const body = buildWebSearchRequest(
    {
      searchQuery: 'GLM 工具 API',
      count: '5',
      searchIntent: true,
      searchDomainFilter: 'docs.bigmodel.cn',
      searchRecencyFilter: 'oneMonth',
      contentSize: 'high'
    },
    { defaultSearchEngine: 'search_pro' }
  )

  assert.deepEqual(body, {
    search_query: 'GLM 工具 API',
    search_engine: 'search_pro',
    search_intent: true,
    count: 5,
    search_recency_filter: 'oneMonth',
    content_size: 'high',
    search_domain_filter: 'docs.bigmodel.cn'
  })
})

test('buildReaderRequest 保留接口默认值并校验 URL', () => {
  const body = buildReaderRequest({ url: 'https://example.com' })

  assert.equal(body.url, 'https://example.com')
  assert.equal(body.timeout, 20)
  assert.equal(body.return_format, 'markdown')
  assert.equal(body.retain_images, true)
})

test('buildModerationRequest 支持文本、媒体 URL 和原始 JSON', () => {
  assert.deepEqual(buildModerationRequest({ text: 'hello' }), {
    model: 'moderation',
    input: 'hello'
  })

  assert.deepEqual(
    buildModerationRequest({ inputType: 'image_url', url: 'https://example.com/a.png' }),
    {
      model: 'moderation',
      input: {
        type: 'image_url',
        image_url: { url: 'https://example.com/a.png' }
      }
    }
  )

  assert.deepEqual(buildModerationRequest({ inputType: 'raw_json', inputJson: '[{\"type\":\"text\",\"text\":\"x\"}]' }), {
    model: 'moderation',
    input: [{ type: 'text', text: 'x' }]
  })
})

test('buildParserFields 和 buildParserResultPath 使用官方字段名', () => {
  assert.deepEqual(buildParserFields({ fileType: 'PDF' }, 'sync'), {
    tool_type: 'prime-sync',
    file_type: 'PDF'
  })
  assert.deepEqual(buildParserFields({ toolType: 'lite' }, 'async'), {
    tool_type: 'lite'
  })
  assert.equal(
    buildParserResultPath({ taskId: 'task 123', formatType: 'download_link' }),
    '/paas/v4/files/parser/result/task%20123/download_link'
  )
})

test('buildParserFields 拒绝不支持的文件类型', () => {
  assert.throws(() => buildParserFields({ fileType: 'WPS' }, 'async'), /fileType/)
  assert.deepEqual(buildParserFields({ fileType: 'WPS' }, 'sync'), {
    tool_type: 'prime-sync',
    file_type: 'WPS'
  })
})

test('buildWebSearchRequest 校验 requestId 与 userId 长度', () => {
  assert.throws(() => buildWebSearchRequest({ searchQuery: 'x', requestId: 'short' }), /requestId/)
  assert.throws(() => buildWebSearchRequest({ searchQuery: 'x', userId: 'short' }), /userId/)
})

test('buildOcrFields 将 boolean 转为 multipart 字符串', () => {
  assert.deepEqual(buildOcrFields({ probability: true, languageType: 'CHN_ENG' }), {
    tool_type: 'hand_write',
    language_type: 'CHN_ENG',
    probability: 'true'
  })
})

test('parseFileSync 未确认付费调用时不会继续执行', async () => {
  const ctx = {
    config: {},
    onCancel() {},
    isCancelled: () => false,
    progress() {},
    output() {}
  }

  await assert.rejects(
    () => commands.parseFileSync(ctx, {}),
    /confirmPaidApiCall=true/
  )
})
