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
 */

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const LAB_HTML = 'ui/lab.html'

const plugin = new BricklyRuntime({ brickId: 'com.brickly.demo-window-lab' })

/** 当前打开的 lab 窗口（profile-scoped cached instance）。 */
let lab = null

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

async function openLab() {
  if (lab && !lab.closed) {
    try {
      await lab.focus()
    } catch {}
    return { windowId: lab.id, reused: true }
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
    if (lab && lab.id === handle.id) lab = null
  })

  return { windowId: handle.id, reused: false }
}

async function closeLab() {
  if (!lab || lab.closed) return 0
  try {
    await lab.close()
  } catch (err) {
    plugin.log.warn(`closeLab failed: ${err.message}`)
  }
  lab = null
  return 1
}

/**
 * 调用 lab 窗口上的一个方法。method 可以是顶层 'maximize' 也可以是 'webContents.send'。
 * args 必须是数组。
 */
async function callOnLab(method, args) {
  if (!lab || lab.closed) {
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
  if (!payload || payload.windowId !== (lab && lab.id)) return
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
      await lab.webContents.send('lab:state', { reqId, state, at: Date.now() })
    } catch (err) {
      plugin.log.warn(`reply lab:state failed: ${err.message}`)
    }
    return
  }
})

plugin.onCommand('open-lab', async () => openLab())
plugin.onCommand('close-lab', async () => ({ closed: await closeLab() }))

plugin.onReady(() => {
  // runtime ready 后延迟一会儿再开窗，确保宿主已就绪
  setTimeout(() => {
    openLab().catch((err) => plugin.log.warn(`auto open failed: ${err.message}`))
  }, 300)
})

plugin.onShutdown(async () => {
  await closeLab().catch(() => {})
})

plugin.start()
