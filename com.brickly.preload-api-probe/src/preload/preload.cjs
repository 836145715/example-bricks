/**
 * Preload 调用探针 — 开发专用。
 *
 * 推荐：bricklyPreload.exposeApi
 * 兼容：contextBridge.exposeInMainWorld（会被平台劫持并记账）
 *
 * 本文件故意包含多种路径，方便对照日志中心：
 *   - 正常成功 / 同步失败 / 异步失败
 *   - 敏感字段（应被摘要脱敏）
 *   - 嵌套对象上的方法
 *   - 绕过尝试（改写 expose、占用保留名、加载期静默 Node 旁路）
 */
'use strict'

const { contextBridge } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const probeMeta = {
  loadedAt: Date.now(),
  platform: process.platform,
  node: process.versions.node,
  hasBricklyPreload: typeof globalThis.bricklyPreload?.exposeApi === 'function',
  bypassNotes: []
}

// ——— 加载期静默旁路（无页面调用 → 日志中心不应出现 preload · 记录）———
try {
  const silentPath = path.join(os.tmpdir(), 'brickly-preload-api-probe-silent.txt')
  fs.writeFileSync(silentPath, `silent load-side effect @ ${new Date().toISOString()}\n`, 'utf8')
  probeMeta.silentWritePath = silentPath
  probeMeta.bypassNotes.push(
    'load-time fs.writeFileSync：属于 preload 内部副作用，不会产生 preload · Trace'
  )
} catch (error) {
  probeMeta.bypassNotes.push(`load-time silent write failed: ${error?.message || error}`)
}

function requireExposeApi() {
  const api = globalThis.bricklyPreload
  if (!api || typeof api.exposeApi !== 'function') {
    throw new Error('bricklyPreload.exposeApi 不可用：平台门禁未安装？')
  }
  return api.exposeApi.bind(api)
}

const exposeApi = requireExposeApi()

// ——— 正规门面：应全部进入日志中心 ———
exposeApi('preloadProbe', {
  /** 健康检查 / 元信息 */
  getMeta() {
    return {
      ...probeMeta,
      now: Date.now(),
      brickly: typeof globalThis.brickly // 隔离上下文里通常没有
    }
  },

  /** 同步成功 */
  echo(value) {
    return { ok: true, echo: value, at: Date.now() }
  },

  /** 同步失败 → Trace status=failed */
  failSync(message = '故意同步失败') {
    throw new Error(String(message || '故意同步失败'))
  },

  /** 异步成功 */
  async echoAsync(value, delayMs = 30) {
    await sleep(Number(delayMs) || 0)
    return { ok: true, echo: value, delayed: true }
  },

  /** 异步失败 */
  async failAsync(message = '故意异步失败', delayMs = 30) {
    await sleep(Number(delayMs) || 0)
    throw new Error(String(message || '故意异步失败'))
  },

  /**
   * 敏感字段：args 里 token/password 应在摘要中变成 [redacted]
   * （日志中心 input.args 可核对）
   */
  loginLike(payload = {}) {
    return {
      ok: true,
      user: payload?.user ?? null,
      // 返回里也带 token，观察 output 脱敏（取决于主进程摘要策略）
      tokenPreview: typeof payload?.token === 'string' ? `len=${payload.token.length}` : null
    }
  },

  nested: {
    deepPing(tag = 'deep') {
      return { layer: 'nested.deepPing', tag, at: Date.now() }
    },
    async deepFail(message = '嵌套异步失败') {
      await sleep(10)
      throw new Error(String(message))
    }
  },

  /** 批量连续调用：用于观察 Trace 条数 */
  async burst(count = 5) {
    const n = Math.min(Math.max(Number(count) || 1, 1), 20)
    const items = []
    for (let i = 0; i < n; i++) {
      items.push({ i, at: Date.now() })
      await sleep(5)
    }
    return { count: n, items }
  }
})

// ——— 兼容路径：旧写法 contextBridge.exposeInMainWorld（应被劫持并记账，source=contextBridge）———
try {
  contextBridge.exposeInMainWorld('preloadProbeLegacy', {
    viaContextBridge(msg = 'legacy') {
      return { via: 'contextBridge.exposeInMainWorld', msg, at: Date.now() }
    },
    failLegacy() {
      throw new Error('legacy 路径故意失败')
    }
  })
  probeMeta.bypassNotes.push(
    'legacy exposeInMainWorld：应被平台转发/记账（Trace source 字段为 contextBridge）'
  )
} catch (error) {
  probeMeta.bypassNotes.push(`legacy exposeInMainWorld 失败: ${error?.message || error}`)
}

// ——— 绕过尝试 1：改回原生 exposeInMainWorld ———
try {
  const desc = Object.getOwnPropertyDescriptor(contextBridge, 'exposeInMainWorld')
  probeMeta.exposeDescriptor = {
    writable: desc?.writable,
    configurable: desc?.configurable,
    enumerable: desc?.enumerable
  }
  let reassigned = false
  try {
    contextBridge.exposeInMainWorld = function hacked() {
      throw new Error('should not reach hacked expose')
    }
    reassigned = true
  } catch (error) {
    probeMeta.bypassNotes.push(
      `改写 exposeInMainWorld 被拒绝（预期）: ${error?.message || error}`
    )
  }
  if (reassigned) {
    probeMeta.bypassNotes.push('警告：exposeInMainWorld 可被赋值覆盖，门禁未锁死')
  }
} catch (error) {
  probeMeta.bypassNotes.push(`探测 expose 描述符失败: ${error?.message || error}`)
}

// ——— 绕过尝试 2：占用保留名 brickly ———
try {
  exposeApi('brickly', { evil() { return true } })
  probeMeta.bypassNotes.push('警告：成功占用保留名 brickly（不应发生）')
} catch (error) {
  probeMeta.bypassNotes.push(`占用保留名 brickly 被拒绝（预期）: ${error?.message || error}`)
}

// ——— 绕过尝试 3：再次 expose 同名，观察是否覆盖 ———
try {
  exposeApi('preloadProbeShadow', {
    first() {
      return 'first'
    }
  })
  exposeApi('preloadProbeShadow', {
    second() {
      return 'second'
    }
  })
  probeMeta.bypassNotes.push('同名二次 exposeApi(preloadProbeShadow)：以最后一次为准')
} catch (error) {
  probeMeta.bypassNotes.push(`二次 expose 失败: ${error?.message || error}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
