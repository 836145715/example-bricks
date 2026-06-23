import { SessionDetail } from '../types'

/**
 * 转换字符串为十六进制视图 (Hex View)
 */
export function toHex(input: string): string {
  if (!input) return ''
  const bytes = new TextEncoder().encode(input)
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16)
    const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
    const text = [...chunk].map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('')
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${text}`)
  }
  return lines.join('\n')
}

/**
 * 格式化 JSON 字符串，美化缩进
 */
export function formatJson(input?: string): string {
  if (!input) return ''
  try {
    return JSON.stringify(JSON.parse(input), null, 2)
  } catch {
    return input
  }
}

/**
 * 解析并格式化 URL 查询参数
 */
export function formatURLParams(input?: string): string {
  if (!input) return ''
  try {
    const parsed = new URL(input)
    return [...parsed.searchParams.entries()].map(([key, value]) => `${key}=${value}`).join('\n')
  } catch {
    return (input.split('?')[1] || '').split('&').filter(Boolean).join('\n')
  }
}

/**
 * 获取响应图片的 Data URL 预览地址
 */
export function responseImageSrc(detail: SessionDetail): string | undefined {
  const contentType = detail.responseHeader?.['Content-Type'] || detail.responseHeader?.['content-type'] || ''
  if (!detail.bodyBase64 || !contentType.toLowerCase().startsWith('image/')) return undefined
  return `data:${contentType};base64,${detail.bodyBase64}`
}

/**
 * 构建请求首行 (如: GET /api HTTP/1.1)
 */
export function requestLine(detail: SessionDetail): string {
  const method = detail.method || detail.direction || detail.phase
  return `${method || detail.protocol} ${detail.path || detail.url || '/'} ${detail.proto || detail.protocol}`
}

/**
 * 构建响应首行 (如: HTTP/1.1 200 OK)
 */
export function responseLine(detail: SessionDetail): string {
  return `${detail.proto || detail.protocol} ${detail.status || detail.phase}`
}

/**
 * 格式化 Headers 头域集合
 */
export function formatHeaders(firstLine: string, headers?: Record<string, string>): string {
  const lines = [firstLine]
  for (const [key, value] of Object.entries(headers || {})) {
    lines.push(`${key}: ${value}`)
  }
  return lines.join('\n')
}

/**
 * 构建完整的原始 HTTP 请求报文
 */
export function buildRawRequest(detail: SessionDetail): string {
  return [formatHeaders(requestLine(detail), detail.requestHeader), detail.requestPreview || ''].filter(Boolean).join('\n\n')
}

/**
 * 构建完整的原始 HTTP 响应报文
 */
export function buildRawResponse(detail: SessionDetail): string {
  return [formatHeaders(responseLine(detail), detail.responseHeader), detail.responsePreview || detail.bodyPreview || ''].filter(Boolean).join('\n\n')
}

/**
 * 根据所选标签渲染请求数据
 */
export function renderRequestTab(detail: SessionDetail, tab: string): string {
  switch (tab) {
    case 'headers':
      return formatHeaders(requestLine(detail), detail.requestHeader)
    case 'text':
      return detail.requestPreview || ''
    case 'hex':
      return toHex(detail.requestPreview || buildRawRequest(detail))
    case 'cookies':
      return detail.requestHeader?.Cookie || detail.requestHeader?.cookie || ''
    case 'params':
      return formatURLParams(detail.url)
    case 'raw':
      return buildRawRequest(detail)
    case 'json':
      return formatJson(detail.requestPreview)
    default:
      return ''
  }
}

/**
 * 根据所选标签渲染响应数据
 */
export function renderResponseTab(detail: SessionDetail, tab: string): string {
  const body = detail.responsePreview || detail.bodyPreview || ''
  switch (tab) {
    case 'headers':
      return formatHeaders(responseLine(detail), detail.responseHeader)
    case 'text':
      return body
    case 'image':
      return responseImageSrc(detail) ? '' : '当前响应不是可预览图片'
    case 'hex':
      return toHex(body)
    case 'cookies':
      return detail.responseHeader?.['Set-Cookie'] || detail.responseHeader?.['set-cookie'] || ''
    case 'raw':
      return buildRawResponse(detail)
    case 'json':
      return formatJson(body)
    default:
      return ''
  }
}

