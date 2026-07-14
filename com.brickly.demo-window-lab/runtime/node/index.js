/* eslint-disable */
'use strict'

/**
 * 窗口 API 实验室 —— Node runtime。
 *
 * 设计：
 *   - 创建一个普通带边框的窗口，UI 即是测试控制面板（lab.html）。
 *   - 子窗口通过 brickly.sendToParent('lab:op', { name, args }) 请求执行某个 API。
 *   - runtime 用 SDK 的 win.call(method, args) 把请求转发给 host，把结果序列化后
 *     通过 win.webContents.send('lab:result', payload) 推回前端展示。
 *   - 'lab:query' 一键拉取全部状态（is* / get* 系列），方便观察"操作前/后"的变化。
 *
 *   注意：lab 操作的"目标窗口"就是 lab 自己。这样测试的方法和效果都在同一处可见。
 *
 *   开窗约定：
 *   - 只通过 open-lab 命令开窗，不在 onReady 自动开窗。
 *     否则会与命令面板触发的 open-lab 竞态，同时创建两个 lab 窗口。
 *   - openLab 全程互斥：并发调用复用同一个 in-flight Promise，避免二次 create。
 */

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

const LAB_HTML = 'ui/lab.html'

const plugin = new BricklyRuntime({ brickId: 'com.brickly.demo-window-lab' })

/** 当前打开的 lab 窗口（profile-scoped cached instance）。 */
let lab = null
/** 进行中的 openLab Promise，防止并发 createBrowserWindow。 */
let openLabInflight = null

/** 状态查询使用的方法清单：[方法名, 是否在 webContents 上] */
const QUERY_METHODS = [
  ['getBounds', false],
  ['getContentBounds', false],
  ['getPosition', false],
  ['getSize', false],
  ['getContentSize', false],
  ['getMinimumSize', false],
  ['getMaximumSize', false],
  ['getNormalBounds', false],
  ['getOpacity', false],
  ['getTitle', false],
  ['isAlwaysOnTop', false],
  ['isVisible', false],
  ['isFocused', false],
  ['isMinimized', false],
  ['isMaximized', false],
  ['isFullScreen', false],
  ['isNormal', false],
  ['isModal', false],
  ['isResizable', false],
  ['isMovable', false],
  ['isFocusable', false],
  ['isMinimizable', false],
  ['isMaximizable', false],
  ['isClosable', false],
  ['isFullScreenable', false],
  ['isEnabled', false],
  ['isKiosk', false],
  ['hasShadow', false],
  ['isVisibleOnAllWorkspaces', false],
  ['isMenuBarVisible', false],
  ['isMenuBarAutoHide', false],
  ['isDestroyed', false],
  ['webContents.getURL', true],
  ['webContents.getTitle', true],
  ['webContents.getZoomFactor', true],
  ['webContents.getZoomLevel', true],
  ['webContents.isDevToolsOpened', true],
  ['webContents.canGoBack', true],
  ['webContents.canGoForward', true]
]

function clearLabIfMatch(handle) {
  if (lab && handle && lab.id === handle.id) lab = null
}

/** 仅信本地 closed 标志；不再 hostCall isDestroyed，避免二次 open 卡在无响应 hostCall。 */
function isLabAlive(handle) {
  return Boolean(handle && !handle.closed)
}

async function openLabOnce() {
  if (isLabAlive(lab)) {
    try {
      await lab.focus()
      if (isLabAlive(lab)) {
        return { windowId: lab.id, reused: true }
      }
    } catch (err) {
      plugin.log.warn(`focus existing lab failed, will recreate: ${err.message || err}`)
      try {
        lab.closed = true
      } catch {
        /* ignore */
      }
      clearLabIfMatch(lab)
    }
  }

  const handle = await plugin.ui.createBrowserWindow(LAB_HTML, {
    width: 980,
    height: 720,
    title: 'Brickly · Window API Lab',
    backgroundColor: '#0f172a',
    show: true,
    resizable: true,
    minimizable: true,
    maximizable: true
  })
  lab = handle

  handle.on('closed', () => {
    plugin.log.info(`lab window closed id=${handle.id}`)
    clearLabIfMatch(handle)
  })

  return { windowId: handle.id, reused: false }
}

/**
 * 串行化 openLab：并发调用共享同一个 Promise，避免 onReady/命令/连点 同时 create 两个窗口。
 */
function openLab() {
  if (openLabInflight) return openLabInflight
  openLabInflight = openLabOnce()
    .catch((err) => {
      // 创建失败时清掉可能半初始化的引用，方便下次重试
      if (lab && lab.closed) lab = null
      throw err
    })
    .finally(() => {
      openLabInflight = null
    })
  return openLabInflight
}

async function closeLab() {
  // 若正在开窗，等开完再关，避免 create 完成时又把 lab 写回来
  if (openLabInflight) {
    try {
      await openLabInflight
    } catch {
      /* ignore */
    }
  }
  const handle = lab
  if (!isLabAlive(handle)) {
    lab = null
    return 0
  }
  try {
    await handle.close()
  } catch (err) {
    plugin.log.warn(`closeLab failed: ${err.message}`)
  }
  clearLabIfMatch(handle)
  lab = null
  return 1
}

/**
 * 调用 lab 窗口上的一个方法。method 可以是顶层 'maximize' 也可以是 'webContents.send'。
 * args 必须是数组。
 */
async function callOnLab(method, args) {
  if (!isLabAlive(lab)) {
    throw new Error('lab window not open')
  }
  // SDK 的 win.call 已经支持所有白名单方法（包含 'webContents.*' 形式）
  return await lab.call(method, Array.isArray(args) ? args : [])
}

/** 把任意值缩成可读 JSON（处理 undefined / function / BigInt）。 */
function safeJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'function') return `[function ${v.name || 'anon'}]`
      if (typeof v === 'bigint') return v.toString()
      if (typeof v === 'undefined') return null
      return v
    })
  )
}

/** 批量执行 QUERY_METHODS，组装成 { method: result | {error} } 字典。 */
async function queryAllState() {
  const out = {}
  for (const [method] of QUERY_METHODS) {
    try {
      out[method] = safeJson(await callOnLab(method, []))
    } catch (err) {
      out[method] = { __error: String(err && err.message ? err.message : err) }
    }
  }
  return out
}

/** 接收子窗口的请求。 */
plugin.events.on('window.message', async (payload) => {
  if (!payload || !lab || payload.windowId !== lab.id) return
  const { channel, args } = payload
  if (channel === 'lab:op') {
    const [op] = args || []
    if (!op || typeof op !== 'object') return
    const { name, args: opArgs, reqId } = op
    let result, error
    try {
      result = safeJson(await callOnLab(name, opArgs))
    } catch (err) {
      error = String(err && err.message ? err.message : err)
    }
    try {
      if (!isLabAlive(lab)) return
      // 用 webContents.send 把结果推回子窗口（子窗口通过 brickly.on 接收）
      await lab.webContents.send('lab:result', {
        reqId,
        name,
        ok: !error,
        result: result === undefined ? null : result,
        error: error || null
      })
    } catch (err) {
      plugin.log.warn(`reply lab:result failed: ${err.message}`)
    }
    return
  }
  if (channel === 'lab:query') {
    const [{ reqId } = {}] = args || []
    const state = await queryAllState()
    try {
      if (!isLabAlive(lab)) return
      await lab.webContents.send('lab:state', { reqId, state, at: Date.now() })
    } catch (err) {
      plugin.log.warn(`reply lab:state failed: ${err.message}`)
    }
    return
  }
})

plugin.onCommand('open-lab', async (ctx) => {
  // 取消时尽快失败；host.createBrowserWindow 仍可能在后台完成，由 closed/下一次 isLabAlive 清理
  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    ctx.onCancel(() => {
      finish(reject, new BppError('CANCELLED', '打开实验室已取消'))
    })
    if (ctx.isCancelled()) {
      finish(reject, new BppError('CANCELLED', '打开实验室已取消'))
      return
    }
    openLab().then(
      (result) => finish(resolve, result),
      (err) => finish(reject, err)
    )
  })
})

plugin.onCommand('close-lab', async () => ({ closed: await closeLab() }))

// 不在 onReady 自动开窗：宿主打开 ui.none 时会先出命令面板，再运行 open-lab。
// 若此处再 auto-open，会与 open-lab 竞态创建两个实验室窗口。

plugin.onShutdown(async () => {
  await closeLab().catch(() => {})
})

plugin.start()
