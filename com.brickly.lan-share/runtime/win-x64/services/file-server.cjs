'use strict'

/**
 * 内网文件共享 HTTP 服务。
 *
 * 职责：在指定端口上提供目录浏览、文件下载（支持 Range 断点续传）、可选上传与
 * 可选访问码鉴权。所有文件系统访问都通过 safe-path 限制在共享根目录内。
 *
 * 该类只负责单次「服务实例」的生命周期；启停编排与配置由 share-service 负责。
 */

const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { pipeline } = require('node:stream/promises')

const { resolveWithinRoot } = require('./safe-path.cjs')
const { lookupMime } = require('./mime.cjs')
const { renderListingPage } = require('./listing-page.cjs')

const UPLOAD_SUFFIX = '/__upload'

class FileServer {
  /**
   * @param {object} options
   * @param {string} options.root 共享根目录绝对路径
   * @param {number} options.port 监听端口
   * @param {boolean} [options.allowUpload] 是否允许上传
   * @param {string} [options.accessCode] 访问码；非空时启用 Basic Auth
   * @param {(entry: object) => void} [options.onLog] 传输日志回调
   */
  constructor({ root, port, allowUpload = false, accessCode = '', onLog }) {
    this.root = path.resolve(root)
    this.port = Number(port)
    this.allowUpload = Boolean(allowUpload)
    this.accessCode = typeof accessCode === 'string' ? accessCode.trim() : ''
    this.onLog = typeof onLog === 'function' ? onLog : () => {}
    this.server = null
    this.sockets = new Set()
  }

  /**
   * 启动服务。监听成功时 resolve；端口占用等错误时 reject。
   * @returns {Promise<{ port: number }>}
   */
  start() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          this.sendError(req, res, 500, `服务器内部错误：${error?.message || error}`)
        })
      })

      server.on('connection', (socket) => {
        this.sockets.add(socket)
        socket.on('close', () => this.sockets.delete(socket))
      })

      const onError = (error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        this.server = server
        resolve({ port: this.port })
      }

      server.once('error', onError)
      server.once('listening', onListening)
      // 绑定 0.0.0.0 以便局域网其他设备访问。
      server.listen(this.port, '0.0.0.0')
    })
  }

  /**
   * 停止服务并断开所有连接。
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      const server = this.server
      this.server = null
      for (const socket of this.sockets) {
        socket.destroy()
      }
      this.sockets.clear()
      server.close(() => resolve())
    })
  }

  /** 处理单个请求。 */
  async handleRequest(req, res) {
    if (!this.authorize(req)) {
      res.statusCode = 401
      res.setHeader('WWW-Authenticate', 'Basic realm="LAN Share"')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      const body = '需要访问码'
      this.finishLog(req, res, Buffer.byteLength(body))
      res.end(body)
      return
    }

    const method = (req.method || 'GET').toUpperCase()
    const urlPath = (req.url || '/').split('?')[0]

    if (method === 'POST' && urlPath.endsWith(UPLOAD_SUFFIX)) {
      await this.handleUpload(req, res)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      this.sendError(req, res, 405, '不支持的请求方法')
      return
    }

    await this.handleRead(req, res, method)
  }

  /** Basic Auth 校验；未设置访问码时直接放行。 */
  authorize(req) {
    if (!this.accessCode) return true
    const header = req.headers.authorization || ''
    if (!header.startsWith('Basic ')) return false
    let decoded = ''
    try {
      decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    } catch {
      return false
    }
    // 用户名忽略，密码部分与访问码做定长比较，避免时序泄露。
    const password = decoded.slice(decoded.indexOf(':') + 1)
    return timingSafeEqual(password, this.accessCode)
  }

  /** 处理目录浏览与文件下载。 */
  async handleRead(req, res, method) {
    const resolved = resolveWithinRoot(this.root, req.url || '/')
    if (!resolved.ok) {
      this.sendError(req, res, 400, '非法的访问路径')
      return
    }

    let stat
    try {
      stat = await fsp.stat(resolved.absolutePath)
    } catch {
      this.sendError(req, res, 404, '文件或目录不存在')
      return
    }

    if (stat.isDirectory()) {
      await this.sendDirectory(req, res, method, resolved.absolutePath, resolved.relativePath)
      return
    }

    await this.sendFile(req, res, method, resolved.absolutePath, stat)
  }

  /** 渲染并返回目录列表页面。 */
  async sendDirectory(req, res, method, absolutePath, relativePath) {
    const dirents = await fsp.readdir(absolutePath, { withFileTypes: true })
    const entries = []
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      let size = 0
      let modifiedAt = 0
      try {
        const entryStat = await fsp.stat(path.join(absolutePath, dirent.name))
        size = entryStat.size
        modifiedAt = entryStat.mtimeMs
      } catch {
        continue
      }
      entries.push({ name: dirent.name, isDirectory: dirent.isDirectory(), size, modifiedAt })
    }

    const html = renderListingPage({
      relativePath,
      entries,
      allowUpload: this.allowUpload
    })
    const buffer = Buffer.from(html, 'utf8')
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Length', buffer.length)
    this.finishLog(req, res, method === 'HEAD' ? 0 : buffer.length)
    if (method === 'HEAD') {
      res.end()
      return
    }
    res.end(buffer)
  }

  /** 返回文件内容，支持 Range 断点续传与强制下载。 */
  async sendFile(req, res, method, absolutePath, stat) {
    const total = stat.size
    const wantsDownload = /[?&]download=1(?:&|$)/.test(req.url || '')
    const mime = lookupMime(absolutePath)

    res.setHeader('Content-Type', mime)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Last-Modified', stat.mtime.toUTCString())
    if (wantsDownload) {
      const fileName = path.basename(absolutePath)
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      )
    }

    const range = parseRange(req.headers.range, total)
    if (range === 'invalid') {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${total}`)
      this.finishLog(req, res, 0)
      res.end()
      return
    }

    const start = range ? range.start : 0
    const end = range ? range.end : total - 1
    const chunkSize = total === 0 ? 0 : end - start + 1

    res.statusCode = range ? 206 : 200
    res.setHeader('Content-Length', chunkSize)
    if (range) {
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
    }

    if (method === 'HEAD' || total === 0) {
      this.finishLog(req, res, 0)
      res.end()
      return
    }

    this.finishLog(req, res, chunkSize)
    const stream = fs.createReadStream(absolutePath, { start, end })
    stream.on('error', () => {
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
    stream.pipe(res)
  }

  /** 接收上传：原始请求体即文件内容，文件名通过 query 传入。 */
  async handleUpload(req, res) {
    if (!this.allowUpload) {
      this.sendError(req, res, 403, '上传未开启')
      return
    }

    const urlObj = safeParseUrl(req.url)
    const rawName = urlObj?.searchParams.get('name') || ''
    const fileName = sanitizeFileName(rawName)
    if (!fileName) {
      this.sendError(req, res, 400, '缺少合法的文件名')
      return
    }

    // 上传目标目录由 URL 路径（去掉 __upload 段）决定，并做穿越校验。
    const dirPath = (req.url || '/').split('?')[0].slice(0, -UPLOAD_SUFFIX.length) || '/'
    const resolvedDir = resolveWithinRoot(this.root, dirPath)
    if (!resolvedDir.ok) {
      this.sendError(req, res, 400, '非法的上传目录')
      return
    }

    try {
      const dirStat = await fsp.stat(resolvedDir.absolutePath)
      if (!dirStat.isDirectory()) {
        this.sendError(req, res, 400, '上传目标不是目录')
        return
      }
    } catch {
      this.sendError(req, res, 404, '上传目录不存在')
      return
    }

    const target = await uniqueTarget(resolvedDir.absolutePath, fileName)
    const writeStream = fs.createWriteStream(target)
    let received = 0
    req.on('data', (chunk) => {
      received += chunk.length
    })

    try {
      await pipeline(req, writeStream)
    } catch (error) {
      await fsp.rm(target, { force: true }).catch(() => {})
      this.sendError(req, res, 500, `上传失败：${error?.message || error}`)
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    const body = JSON.stringify({ ok: true, name: path.basename(target), size: received })
    this.finishLog(req, res, received)
    res.end(body)
  }

  /** 统一错误响应。 */
  sendError(req, res, status, message) {
    if (res.headersSent) {
      res.end()
      return
    }
    res.statusCode = status
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    const body = String(message || '')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    this.finishLog(req, res, Buffer.byteLength(body))
    res.end(body)
  }

  /** 在响应结束后记录一条传输日志。 */
  finishLog(req, res, bytes) {
    const method = (req.method || 'GET').toUpperCase()
    const reqPath = decodeSafe((req.url || '/').split('?')[0])
    res.once('finish', () => {
      this.onLog({
        id: crypto.randomUUID(),
        at: Date.now(),
        ip: clientIp(req),
        method,
        path: reqPath,
        status: res.statusCode,
        bytes
      })
    })
  }
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * 解析 Range 头。
 * @returns {null | 'invalid' | { start: number, end: number }}
 */
function parseRange(header, total) {
  if (!header || typeof header !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'invalid'
  const [, startRaw, endRaw] = match
  if (startRaw === '' && endRaw === '') return 'invalid'

  let start
  let end
  if (startRaw === '') {
    // 后缀范围：最后 N 字节。
    const suffix = Number(endRaw)
    if (suffix <= 0) return 'invalid'
    start = Math.max(total - suffix, 0)
    end = total - 1
  } else {
    start = Number(startRaw)
    end = endRaw === '' ? total - 1 : Number(endRaw)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid'
  if (start > end || start < 0 || start >= total) return 'invalid'
  if (end >= total) end = total - 1
  return { start, end }
}

function sanitizeFileName(value) {
  // 反斜杠统一视为分隔符，兼容 Windows 客户端传来的路径。
  const base = path.posix.basename(String(value || '').replace(/\\/g, '/'))
  const cleaned = base.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').trim()
  return cleaned.slice(0, 200)
}

/** 若目标已存在则追加序号，避免覆盖已有文件。 */
async function uniqueTarget(dir, fileName) {
  const ext = path.extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  let candidate = path.join(dir, fileName)
  let counter = 1
  while (await exists(candidate)) {
    candidate = path.join(dir, `${stem} (${counter})${ext}`)
    counter += 1
  }
  return candidate
}

async function exists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

function safeParseUrl(url) {
  try {
    return new URL(url || '/', 'http://localhost')
  } catch {
    return null
  }
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function clientIp(req) {
  const remote = req.socket?.remoteAddress || ''
  // 归一化 IPv4-mapped IPv6 地址（::ffff:192.168.1.2）。
  return remote.replace(/^::ffff:/, '')
}

module.exports = { FileServer, parseRange, sanitizeFileName }
