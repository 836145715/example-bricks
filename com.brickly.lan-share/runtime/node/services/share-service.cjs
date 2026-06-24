'use strict'

/**
 * 共享服务编排。
 *
 * 职责：
 *   1. 持久化与读取用户配置（共享目录、端口、上传开关、访问码）。
 *   2. 管理 FileServer 实例的启停生命周期。
 *   3. 维护传输日志环形缓冲，并对外提供状态快照。
 *
 * 这里是应用层：把网络发现、HTTP 服务、文件系统访问等基础能力组合成业务流程，
 * 不直接处理 HTTP 请求细节。
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { FileServer } = require('./file-server.cjs')
const { buildAccessUrls } = require('./network.cjs')

const DEFAULT_PORT = 8723
const MAX_LOG_ENTRIES = 200

const DEFAULT_CONFIG = Object.freeze({
  root: '',
  port: DEFAULT_PORT,
  allowUpload: false,
  accessCode: ''
})

class ShareService {
  /**
   * @param {object} options
   * @param {string} options.dataDir 配置持久化目录
   * @param {(message: string) => void} [options.log] 调试日志输出
   */
  constructor({ dataDir, log }) {
    this.dataDir = dataDir
    this.configPath = path.join(dataDir, 'config.json')
    this.log = typeof log === 'function' ? log : () => {}
    this.config = { ...DEFAULT_CONFIG }
    this.server = null
    this.running = false
    this.startedAt = 0
    this.activePort = 0
    this.logEntries = []
  }

  /** 从磁盘载入配置；文件缺失或损坏时回退默认值。 */
  async loadConfig() {
    try {
      await fsp.mkdir(this.dataDir, { recursive: true })
      const raw = await fsp.readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(raw)
      this.config = normalizeConfig({ ...DEFAULT_CONFIG, ...parsed })
    } catch {
      this.config = { ...DEFAULT_CONFIG }
    }
    return this.config
  }

  /** 合并并持久化配置（不影响正在运行的服务）。 */
  async updateConfig(partial) {
    this.config = normalizeConfig({ ...this.config, ...sanitizePartial(partial) })
    await fsp.mkdir(this.dataDir, { recursive: true })
    await fsp.writeFile(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8')
    return this.config
  }

  /** 返回推荐的默认共享目录：优先下载目录，其次主目录。 */
  defaultRoot() {
    if (this.config.root) return this.config.root
    const downloads = path.join(os.homedir(), 'Downloads')
    try {
      if (fs.statSync(downloads).isDirectory()) return downloads
    } catch {
      // 忽略，回退主目录。
    }
    return os.homedir()
  }

  /**
   * 启动共享服务。
   * @param {Partial<typeof DEFAULT_CONFIG>} [overrides] 启动时的临时配置（同时持久化）
   */
  async start(overrides = {}) {
    if (this.running) {
      return this.status()
    }

    await this.updateConfig(overrides)
    const { root, port, allowUpload, accessCode } = this.config

    const resolvedRoot = root || this.defaultRoot()
    await this.assertDirectory(resolvedRoot)

    const server = new FileServer({
      root: resolvedRoot,
      port,
      allowUpload,
      accessCode,
      onLog: (entry) => this.appendLog(entry)
    })

    try {
      await server.start()
    } catch (error) {
      throw toFriendlyStartError(error, port)
    }

    this.server = server
    this.running = true
    this.activePort = port
    this.startedAt = Date.now()
    this.log(`started on port ${port}, root=${resolvedRoot}`)
    return this.status()
  }

  /** 停止共享服务。 */
  async stop() {
    if (this.server) {
      await this.server.stop()
    }
    this.server = null
    this.running = false
    this.activePort = 0
    this.startedAt = 0
    this.log('stopped')
    return this.status()
  }

  /** 列出共享目录下某个相对子路径的条目，供 UI 预览。 */
  async listEntries(subPath = '') {
    const root = this.config.root || this.defaultRoot()
    const normalized = path.normalize(subPath || '').replace(/^([/\\]|\.\.)+/, '')
    const target = path.resolve(root, normalized)
    const rootResolved = path.resolve(root)
    const withSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
    if (target !== rootResolved && !target.startsWith(withSep)) {
      return { root: rootResolved, subPath: '', entries: [], error: 'escape' }
    }

    let dirents
    try {
      dirents = await fsp.readdir(target, { withFileTypes: true })
    } catch (error) {
      return { root: rootResolved, subPath: normalized, entries: [], error: error?.code || 'read-failed' }
    }

    const entries = []
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      let size = 0
      let modifiedAt = 0
      try {
        const stat = await fsp.stat(path.join(target, dirent.name))
        size = stat.size
        modifiedAt = stat.mtimeMs
      } catch {
        continue
      }
      entries.push({ name: dirent.name, isDirectory: dirent.isDirectory(), size, modifiedAt })
    }
    entries.sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
      return left.name.localeCompare(right.name, 'zh-CN')
    })
    return { root: rootResolved, subPath: normalized, entries }
  }

  /** 清空传输日志。 */
  clearLog() {
    this.logEntries = []
  }

  /** 当前状态快照；不暴露访问码明文。 */
  status() {
    const port = this.running ? this.activePort : this.config.port
    return {
      running: this.running,
      port,
      root: this.config.root || this.defaultRoot(),
      allowUpload: this.config.allowUpload,
      hasAccessCode: Boolean(this.config.accessCode),
      startedAt: this.startedAt,
      urls: this.running ? buildAccessUrls(this.activePort) : [],
      log: this.logEntries.slice(0, 50)
    }
  }

  /** 向环形缓冲追加一条传输日志（最新在前）。 */
  appendLog(entry) {
    this.logEntries.unshift(entry)
    if (this.logEntries.length > MAX_LOG_ENTRIES) {
      this.logEntries.length = MAX_LOG_ENTRIES
    }
  }

  async assertDirectory(target) {
    let stat
    try {
      stat = await fsp.stat(target)
    } catch {
      const error = new Error(`共享目录不存在：${target}`)
      error.code = 'ROOT_NOT_FOUND'
      throw error
    }
    if (!stat.isDirectory()) {
      const error = new Error(`共享路径不是目录：${target}`)
      error.code = 'ROOT_NOT_DIRECTORY'
      throw error
    }
  }
}

function normalizeConfig(config) {
  const port = Number(config.port)
  return {
    root: typeof config.root === 'string' ? config.root.trim() : '',
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT,
    allowUpload: Boolean(config.allowUpload),
    accessCode: typeof config.accessCode === 'string' ? config.accessCode.trim() : ''
  }
}

/** 只挑出调用方真正提供的字段，避免 undefined 覆盖已有配置。 */
function sanitizePartial(partial) {
  const result = {}
  if (!partial || typeof partial !== 'object') return result
  if (typeof partial.root === 'string') result.root = partial.root
  if (partial.port !== undefined && partial.port !== null && partial.port !== '') {
    result.port = partial.port
  }
  if (typeof partial.allowUpload === 'boolean') result.allowUpload = partial.allowUpload
  if (typeof partial.accessCode === 'string') result.accessCode = partial.accessCode
  return result
}

function toFriendlyStartError(error, port) {
  if (error && error.code === 'EADDRINUSE') {
    const friendly = new Error(`端口 ${port} 已被占用，请更换端口`)
    friendly.code = 'PORT_IN_USE'
    return friendly
  }
  if (error && error.code === 'EACCES') {
    const friendly = new Error(`无权限监听端口 ${port}，请改用 1024 以上端口`)
    friendly.code = 'PORT_FORBIDDEN'
    return friendly
  }
  return error instanceof Error ? error : new Error(String(error))
}

module.exports = { ShareService, normalizeConfig, DEFAULT_PORT, MAX_LOG_ENTRIES }
