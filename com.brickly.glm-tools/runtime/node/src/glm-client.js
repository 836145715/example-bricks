/* eslint-disable */
'use strict'

const { resolveUploadFile } = require('./file-source')
const { GlmHttpClient } = require('./http-client')
const {
  buildModerationRequest,
  buildOcrFields,
  buildParserFields,
  buildParserResultPath,
  buildReaderRequest,
  buildWebSearchRequest
} = require('./request-builders')
const { makeError } = require('./errors')
const { optionalString } = require('./input')

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api'

function resolveApiKey(config, env = process.env) {
  return (
    optionalString(config.apiKey) ||
    optionalString(env.GLM_API_KEY) ||
    optionalString(env.BIGMODEL_API_KEY) ||
    optionalString(env.ZHIPUAI_API_KEY)
  )
}

function resolveBaseUrl(config, env = process.env) {
  return optionalString(config.baseUrl) || optionalString(env.GLM_BASE_URL) || DEFAULT_BASE_URL
}

function createHttpClient(config, options = {}) {
  const apiKey = resolveApiKey(config || {}, options.env || process.env)
  if (!apiKey) {
    throw makeError('INVALID_CONFIG', '请在 Profile 中配置 BigModel API Key，或设置 GLM_API_KEY')
  }
  return new GlmHttpClient({
    apiKey,
    baseUrl: resolveBaseUrl(config || {}, options.env || process.env),
    fetchImpl: options.fetchImpl
  })
}

class GlmToolsClient {
  constructor(config, options = {}) {
    this.config = config || {}
    this.http = options.httpClient || createHttpClient(this.config, options)
  }

  async webSearch(input, signal) {
    return this.http.requestJson(
      'POST',
      '/paas/v4/web_search',
      buildWebSearchRequest(input, this.config),
      signal
    )
  }

  async reader(input, signal) {
    return this.http.requestJson('POST', '/paas/v4/reader', buildReaderRequest(input), signal)
  }

  async moderateContent(input, signal) {
    return this.http.requestJson(
      'POST',
      '/paas/v4/moderations',
      buildModerationRequest(input),
      signal
    )
  }

  async parseFileSync(input, signal) {
    const file = await resolveUploadFile(input || {}, {
      fileField: 'file',
      pathField: 'filePath',
      label: '待解析文件'
    })
    return this.http.requestMultipart(
      '/paas/v4/files/parser/sync',
      buildParserFields(input, 'sync'),
      file,
      signal
    )
  }

  async createFileParseTask(input, signal) {
    const file = await resolveUploadFile(input || {}, {
      fileField: 'file',
      pathField: 'filePath',
      label: '待解析文件'
    })
    return this.http.requestMultipart(
      '/paas/v4/files/parser/create',
      buildParserFields(input, 'async'),
      file,
      signal
    )
  }

  async getFileParseResult(input, signal) {
    return this.http.requestJson('GET', buildParserResultPath(input), undefined, signal)
  }

  async ocr(input, signal) {
    const file = await resolveUploadFile(input || {}, {
      fileField: 'imageFile',
      pathField: 'imagePath',
      label: '图片文件'
    })
    return this.http.requestMultipart('/paas/v4/files/ocr', buildOcrFields(input), file, signal)
  }
}

module.exports = {
  GlmToolsClient,
  createHttpClient,
  resolveApiKey,
  resolveBaseUrl,
  DEFAULT_BASE_URL
}
