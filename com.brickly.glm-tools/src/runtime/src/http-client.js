/* eslint-disable */
'use strict'

const { makeError } = require('./errors')

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function assertWebRuntime() {
  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw makeError('RUNTIME_UNSUPPORTED', '当前 Node runtime 缺少 fetch/FormData/Blob 支持')
  }
}

function parseMaybeJson(text, contentType) {
  if (!text) return null
  if (contentType && contentType.includes('application/json')) return JSON.parse(text)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractApiError(status, body) {
  if (body && typeof body === 'object' && body.error) {
    const error = body.error
    return {
      code: String(error.code || `GLM_HTTP_${status}`),
      message: String(error.message || `BigModel API 请求失败: HTTP ${status}`)
    }
  }
  if (body && typeof body === 'object' && (body.code || body.message)) {
    return {
      code: String(body.code || `GLM_HTTP_${status}`),
      message: String(body.message || `BigModel API 请求失败: HTTP ${status}`)
    }
  }
  return {
    code: `GLM_HTTP_${status}`,
    message: typeof body === 'string' && body ? body : `BigModel API 请求失败: HTTP ${status}`
  }
}

class GlmHttpClient {
  constructor(options) {
    assertWebRuntime()
    this.baseUrl = trimTrailingSlash(options.baseUrl)
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetchImpl || fetch
  }

  urlFor(path) {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }

  async parseResponse(response) {
    const contentType = response.headers && response.headers.get ? response.headers.get('content-type') || '' : ''
    const text = await response.text()
    let body
    try {
      body = parseMaybeJson(text, contentType)
    } catch (error) {
      throw makeError('INVALID_RESPONSE', `BigModel API 返回了无效 JSON: ${error.message}`)
    }

    if (!response.ok) {
      const apiError = extractApiError(response.status, body)
      throw makeError(apiError.code, apiError.message, { status: response.status })
    }

    if (body && typeof body === 'object' && body.error) {
      const apiError = extractApiError(response.status, body)
      throw makeError(apiError.code, apiError.message, { status: response.status })
    }

    return body
  }

  async requestJson(method, path, body, signal) {
    const response = await this.fetchImpl(this.urlFor(path), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    })
    return this.parseResponse(response)
  }

  async requestMultipart(path, fields, file, signal) {
    const form = new FormData()
    form.append('file', new Blob([file.buffer], { type: file.mimeType }), file.name)
    for (const [key, value] of Object.entries(fields || {})) {
      if (value !== undefined && value !== null && value !== '') form.append(key, String(value))
    }

    const response = await this.fetchImpl(this.urlFor(path), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: form,
      signal
    })
    return this.parseResponse(response)
  }
}

module.exports = {
  GlmHttpClient,
  extractApiError
}
