'use strict'

/**
 * 开窗 / 关窗 / focus / ping（命令与控制台共用）。
 */

const { BppError } = require('@syllm/brickly-sdk')
const { SCENARIOS, DEFAULT_SUITE, listScenarioMeta } = require('./scenarios')
const {
  isAlive,
  getControlWindowId,
  setControlWindowId,
  getWinSession,
  deleteWinSession,
  getScenarioWindowId,
  setScenarioWindowId,
  clearScenarioWindowId,
  listWinSessions,
  allWindowIds
} = require('./win-session-store')
const { notifyControl, notifyWinSession } = require('./notify')
const { bindWinSession, getPendingPings } = require('./bind-win-session')

const CONTROL_HTML = 'ui/control.html'
const CHILD_HTML = 'ui/child.html'

/** @type {{ ui: { createBrowserWindow: Function }, log: { warn: Function, info: Function } } | null} */
let pluginRef = null
let openControlInflight = null

function setOpenWindowsPlugin(plugin) {
  pluginRef = plugin
}

async function openControl() {
  if (openControlInflight) return openControlInflight
  openControlInflight = openControlOnce().finally(() => {
    openControlInflight = null
  })
  return openControlInflight
}

async function openControlOnce() {
  const existingId = getControlWindowId()
  if (existingId != null) {
    const existing = getWinSession(existingId)
    if (existing && isAlive(existing.handle)) {
      try {
        await existing.handle.focus()
        return { windowId: existing.handle.id, reused: true, role: 'control' }
      } catch (err) {
        pluginRef?.log.warn(`focus control failed, recreate: ${err.message || err}`)
        try {
          existing.handle.closed = true
        } catch {
          /* ignore */
        }
        deleteWinSession(existingId)
        setControlWindowId(null)
      }
    } else {
      setControlWindowId(null)
    }
  }

  const handle = await pluginRef.ui.createBrowserWindow(CONTROL_HTML, {
    width: 1100,
    height: 760,
    title: 'Brickly · 窗口场景测试台',
    backgroundColor: '#0b1220',
    show: true,
    resizable: true,
    minimizable: true,
    maximizable: true
  })
  const winSession = bindWinSession(handle, {
    role: 'control',
    title: '窗口场景测试台'
  })
  setControlWindowId(handle.id)

  const pushBootstrap = () => {
    void notifyControl('scenarios', { scenarios: listScenarioMeta() })
    void notifyControl('winSessions', { winSessions: listWinSessions() })
    void notifyControl('log', { level: 'ok', message: `control ready #${handle.id}` })
  }
  setTimeout(pushBootstrap, 300)
  setTimeout(pushBootstrap, 1200)

  return { windowId: winSession.handle.id, reused: false, role: 'control' }
}

async function openScenario(input = {}) {
  const scenario = String(input.scenario || 'standard')
  const mode = String(input.mode || 'ensure') === 'new' ? 'new' : 'ensure'
  const preset = SCENARIOS[scenario]
  if (!preset) {
    throw new BppError('INVALID_INPUT', `unknown scenario: ${scenario}`)
  }

  if (mode === 'ensure') {
    const existingId = getScenarioWindowId(scenario)
    if (existingId != null) {
      const existing = getWinSession(existingId)
      if (existing && isAlive(existing.handle)) {
        try {
          await existing.handle.focus()
          return {
            windowId: existing.handle.id,
            reused: true,
            role: 'scenario',
            scenario
          }
        } catch (err) {
          pluginRef?.log.warn(`focus scenario ${scenario} failed: ${err.message || err}`)
          try {
            existing.handle.closed = true
          } catch {
            /* ignore */
          }
          deleteWinSession(existingId)
          clearScenarioWindowId(scenario)
        }
      } else {
        clearScenarioWindowId(scenario)
      }
    }
  }

  const title = input.title ? String(input.title) : preset.options.title
  const options = { ...preset.options, title, show: true }
  const handle = await pluginRef.ui.createBrowserWindow(CHILD_HTML, options)
  const winSession = bindWinSession(handle, {
    role: 'scenario',
    scenario,
    title
  })
  if (mode === 'ensure') {
    setScenarioWindowId(scenario, handle.id)
  }

  setTimeout(() => {
    void notifyWinSession(winSession, 'child:hello', {
      windowId: handle.id,
      role: 'scenario',
      scenario,
      title
    })
    void notifyControl('winSessions', { winSessions: listWinSessions() })
  }, 180)

  return {
    windowId: winSession.handle.id,
    reused: false,
    role: 'scenario',
    scenario
  }
}

async function openSuite(input = {}) {
  const mode = String(input.mode || 'new') === 'ensure' ? 'ensure' : 'new'
  const list =
    Array.isArray(input.scenarios) && input.scenarios.length
      ? input.scenarios.map(String)
      : DEFAULT_SUITE
  const opened = []
  const errors = []
  for (const scenario of list) {
    try {
      opened.push(await openScenario({ scenario, mode }))
    } catch (err) {
      errors.push({ scenario, error: String(err.message || err) })
    }
  }
  return { opened, errors, mode }
}

async function focusWinSession(windowId) {
  const winSession = getWinSession(windowId)
  if (!winSession || !isAlive(winSession.handle)) {
    throw new BppError('NOT_FOUND', `window ${windowId} not open`)
  }
  await winSession.handle.focus()
  return { ok: true, windowId }
}

async function closeWinSession(windowId) {
  const winSession = getWinSession(windowId)
  if (!winSession || !isAlive(winSession.handle)) {
    return { ok: false, windowId, reason: 'not-open' }
  }
  try {
    await winSession.handle.close()
  } catch (err) {
    pluginRef?.log.warn(`closeWinSession ${windowId}: ${err.message || err}`)
  }
  return { ok: true, windowId }
}

async function closeAll(keepControl = true) {
  let closed = 0
  for (const id of allWindowIds()) {
    const winSession = getWinSession(id)
    if (!winSession) continue
    if (keepControl && winSession.role === 'control') continue
    if (!isAlive(winSession.handle)) continue
    try {
      await winSession.handle.close()
      closed += 1
    } catch (err) {
      pluginRef?.log.warn(`closeAll ${id}: ${err.message || err}`)
    }
  }
  return closed
}

function pingWinSession(windowId, text = 'hello') {
  const winSession = getWinSession(windowId)
  if (!winSession || !isAlive(winSession.handle)) {
    return Promise.reject(new BppError('NOT_FOUND', `window ${windowId} not open`))
  }
  if (winSession.role === 'control') {
    return Promise.reject(new BppError('INVALID_INPUT', 'ping only supports scenario children'))
  }
  const reqId = `ping-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const key = `${windowId}:${reqId}`
  const pendingPings = getPendingPings()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingPings.delete(key)
      reject(new BppError('TIMEOUT', `pong timeout for window ${windowId}`))
    }, 4000)
    timer.unref?.()
    pendingPings.set(key, { resolve, reject, timer })
    notifyWinSession(winSession, 'child:ping', { reqId, text }).catch((err) => {
      clearTimeout(timer)
      pendingPings.delete(key)
      reject(err)
    })
  })
}

module.exports = {
  setOpenWindowsPlugin,
  openControl,
  openScenario,
  openSuite,
  focusWinSession,
  closeWinSession,
  closeAll,
  pingWinSession,
  listWinSessions
}
