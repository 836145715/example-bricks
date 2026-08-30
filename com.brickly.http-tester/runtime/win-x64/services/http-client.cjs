'use strict'

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const MAX_BODY_CHARS = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30000
const MAX_TIMEOUT_MS = 120000

class ClientError extends Error {
  constructor(code, message, details) {
    super(message)
    this.code = code
    this.details = details
  }
}

function normalizeHeaders(input) {
  const out = {}
  if (input == null) return out
  if (Array.isArray(input)) {
    for (const row of input) {
      if (!row || typeof row !== 'object') continue
      const name = String(row.name ?? '').trim().toLowerCase()
      if (!name) continue
      out[name] = row.value == null ? '' : String(row.value)
    }
    return out
  }
  if (typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      const name = String(k).trim().toLowerCase()
      if (!name) continue
      out[name] = v == null ? '' : String(v)
    }
    return out
  }
  throw new ClientError('INVALID_INPUT', 'headers must be an object or array of {name,value}')
}

function normalizeQuery(input) {
  if (input == null) return []
  if (Array.isArray(input)) {
    return input
      .filter((r) => r && String(r.name ?? '').trim())
      .map((r) => ({ name: String(r.name).trim(), value: r.value == null ? '' : String(r.value) }))
  }
  if (typeof input === 'object') {
    return Object.entries(input).map(([name, value]) => ({
      name: String(name),
      value: value == null ? '' : String(value)
    }))
  }
  throw new ClientError('INVALID_INPUT', 'query must be an object or array of {name,value}')
}

function mergeQuery(urlString, queryInput) {
  const url = new URL(urlString)
  for (const { name, value } of normalizeQuery(queryInput)) {
    url.searchParams.set(name, value)
  }
  return url.toString()
}

function hasHeader(headers, name) {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

function maybeDefaultJsonContentType(headers, body) {
  if (!body || hasHeader(headers, 'content-type')) return
  const trimmed = body.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return
  try {
    JSON.parse(trimmed)
    headers['content-type'] = 'application/json'
  } catch {
    // leave unset
  }
}

function responseHeadersToObject(headers) {
  const out = {}
  headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (out[k]) out[k] = `${out[k]}, ${value}`
    else out[k] = value
  })
  return out
}

async function sendHttpRequest(input) {
  const raw = input || {}
  const method = String(raw.method || 'GET').toUpperCase()
  if (!ALLOWED_METHODS.has(method)) {
    throw new ClientError('INVALID_INPUT', `Unsupported method: ${method}`)
  }

  const urlRaw = String(raw.url || '').trim()
  if (!urlRaw) throw new ClientError('INVALID_INPUT', 'url is required')

  let finalUrl
  try {
    finalUrl = mergeQuery(urlRaw, raw.query)
    const u = new URL(finalUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new ClientError('INVALID_INPUT', 'url must be http or https')
    }
  } catch (e) {
    if (e instanceof ClientError) throw e
    throw new ClientError('INVALID_INPUT', `Invalid url: ${e.message}`)
  }

  let timeoutMs = raw.timeoutMs == null ? DEFAULT_TIMEOUT_MS : Number(raw.timeoutMs)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ClientError('INVALID_INPUT', `timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`)
  }

  const headers = normalizeHeaders(raw.headers)
  let body = raw.body == null ? '' : String(raw.body)
  if (method === 'GET' || method === 'HEAD') body = undefined
  else if (body) maybeDefaultJsonContentType(headers, body)
  else body = undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const response = await fetch(finalUrl, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal
    })

    const headerObj = responseHeadersToObject(response.headers)
    const contentType = headerObj['content-type'] || ''
    let text = await response.text()
    const bodySize = text.length
    let truncated = false
    if (text.length > MAX_BODY_CHARS) {
      text = text.slice(0, MAX_BODY_CHARS)
      truncated = true
    }

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - started,
      finalUrl: response.url || finalUrl,
      contentType,
      headers: headerObj,
      body: text,
      bodySize,
      truncated
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new ClientError('TIMEOUT', `Request timed out after ${timeoutMs}ms`)
    }
    throw new ClientError('NETWORK_ERROR', e && e.message ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  sendHttpRequest,
  normalizeHeaders,
  mergeQuery,
  MAX_BODY_CHARS,
  ClientError
}
