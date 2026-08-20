'use strict'

/**
 * 路径安全解析。
 *
 * 文件服务面向局域网开放，必须严格保证所有访问都被限制在共享根目录内，
 * 杜绝 `..`、绝对路径、符号穿越等导致的目录穿越漏洞。
 */

const path = require('node:path')

/**
 * 将 URL 中的请求路径解析为共享根目录下的绝对路径。
 *
 * @param {string} root 共享根目录的绝对路径
 * @param {string} requestPath URL pathname（可包含百分号编码）
 * @returns {{ ok: true, absolutePath: string, relativePath: string } | { ok: false, reason: string }}
 */
function resolveWithinRoot(root, requestPath) {
  if (typeof root !== 'string' || !root) {
    return { ok: false, reason: 'invalid-root' }
  }

  let decoded
  try {
    decoded = decodeURIComponent(requestPath || '/')
  } catch {
    return { ok: false, reason: 'invalid-encoding' }
  }

  // 去掉查询串残留并统一分隔符，POSIX 规范化后再拼接到根目录。
  const cleaned = decoded.split('?')[0].split('#')[0].replace(/\\/g, '/')
  const normalized = path.posix.normalize(cleaned)
  if (normalized.includes('\0')) {
    return { ok: false, reason: 'invalid-char' }
  }

  const relativePath = normalized.replace(/^\/+/, '')
  const rootResolved = path.resolve(root)
  const absolutePath = path.resolve(rootResolved, relativePath)

  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
  if (absolutePath !== rootResolved && !absolutePath.startsWith(rootWithSep)) {
    return { ok: false, reason: 'escape' }
  }

  return { ok: true, absolutePath, relativePath }
}

module.exports = { resolveWithinRoot }
