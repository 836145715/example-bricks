/**
 * Extract a resolvable hostname from free-form user input.
 * Accepts bare domains and full URLs (with path / port / credentials).
 *
 * https://xdcx.ahzmwl.com/bbxy/login → xdcx.ahzmwl.com
 */

export type ParseSource = 'empty' | 'domain' | 'url' | 'invalid'

export interface ParsedDomain {
  domain: string | null
  raw: string
  source: ParseSource
  hint: string
}

const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

export function isValidDomain(value: string): boolean {
  const v = value.trim().replace(/\.$/, '')
  if (!v || v.length > 253 || v.includes('..')) return false
  return DOMAIN_RE.test(v)
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end !== -1) return host.slice(1, end)
  }
  if ((host.match(/:/g) ?? []).length === 1) {
    return host.split(':')[0] ?? host
  }
  return host
}

function looksLikeUrl(value: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return true
  if (value.startsWith('//')) return true
  if (/[/?#]/.test(value)) return true
  if (/^[^\s/]+:\d{1,5}(\/|$)/.test(value)) return true
  return false
}

function extractViaUrl(value: string): string | null {
  try {
    let candidate = value
    if (candidate.startsWith('//')) candidate = `https:${candidate}`
    else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
      candidate = `https://${candidate}`
    }
    const url = new URL(candidate)
    if (!url.hostname) return null
    return stripPort(url.hostname).toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
}

function extractFallback(value: string): string | null {
  let host = value
  const at = host.lastIndexOf('@')
  if (at !== -1) host = host.slice(at + 1)
  host = host.split(/[/?#]/)[0] ?? host
  host = stripPort(host)
  host = host.replace(/^\[|\]$/g, '')
  host = host.toLowerCase().replace(/\.$/, '').trim()
  return host || null
}

export function parseDomainInput(input: string): ParsedDomain {
  const raw = input.trim()
  if (!raw) {
    return {
      domain: null,
      raw,
      source: 'empty',
      hint: '粘贴域名或完整网址，自动识别主机名'
    }
  }

  const asUrl = looksLikeUrl(raw)
  const host = asUrl
    ? (extractViaUrl(raw) ?? extractFallback(raw))
    : extractFallback(raw)

  if (!host) {
    return { domain: null, raw, source: 'invalid', hint: '无法识别域名，请检查输入' }
  }

  if (!isValidDomain(host)) {
    return {
      domain: null,
      raw,
      source: 'invalid',
      hint: host.includes('.')
        ? `主机名无效：${host}`
        : '请输入带顶级域的完整域名，例如 example.com'
    }
  }

  if (asUrl && host !== raw.toLowerCase()) {
    return {
      domain: host,
      raw,
      source: 'url',
      hint: `已识别域名 ${host}`
    }
  }

  return {
    domain: host,
    raw,
    source: 'domain',
    hint: `将解析 ${host}`
  }
}
