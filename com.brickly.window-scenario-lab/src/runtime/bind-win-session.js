'use strict'

/**
 * 创建窗后立刻绑定 handle 事件 → WinSession 入仓。
 */

const { BppError } = require('@syllm/brickly-sdk')
const {
  setWinSession,
  deleteWinSession,
  getControlWindowId,
  setControlWindowId,
  clearScenarioWindowId,
  listWinSessions
} = require('./win-session-store')
const { notifyControl } = require('./notify')

const HIGH_FREQ_EVENTS = new Set(['move', 'resize'])
const EVENT_NOTIFY_MIN_MS = 400
/** @type {Map<string, number>} */
const eventNotifyAt = new Map()

/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
const pendingPings = new Map()

/** @type {{ log: { info: Function, warn: Function }, onWindowNotify: Function } | null} */
let deps = null

function setBindDeps(next) {
  deps = next
}

function getPendingPings() {
  return pendingPings
}

function pushEvent(winSession, event, detail) {
  const at = Date.now()
  const storedDetail = HIGH_FREQ_EVENTS.has(event) ? undefined : detail
  winSession.events.push({ at, event, detail: storedDetail })
  if (winSession.events.length > 80) {
    winSession.events.splice(0, winSession.events.length - 80)
  }

  const key = `${winSession.handle.id}:${event}`
  if (HIGH_FREQ_EVENTS.has(event)) {
    const last = eventNotifyAt.get(key) || 0
    if (at - last < EVENT_NOTIFY_MIN_MS) return
    eventNotifyAt.set(key, at)
  }

  void notifyControl('win-session-event', {
    windowId: winSession.handle.id,
    event,
    detail: HIGH_FREQ_EVENTS.has(event) ? null : detail || null,
    at,
    eventCount: winSession.events.length
  })
}

/**
 * @param {import('@syllm/brickly-sdk').WindowHandle} handle
 * @param {{ role: 'control'|'scenario', scenario?: string, title: string }} meta
 */
function bindWinSession(handle, meta) {
  /** @type {import('./types').WinSession} */
  const winSession = {
    handle,
    role: meta.role,
    scenario: meta.scenario,
    title: meta.title,
    createdAt: Date.now(),
    events: []
  }
  setWinSession(handle.id, winSession)

  const notify = (channel, body) => {
    void deps?.onWindowNotify(winSession, channel, body && typeof body === 'object' ? body : {})
  }
  if (meta.role === 'control') {
    handle.expose({
      'control:refresh'(body) {
        notify('control:refresh', body)
      },
      'control:open-scenario'(body) {
        notify('control:open-scenario', body)
      },
      'control:open-suite'(body) {
        notify('control:open-suite', body)
      },
      'control:focus'(body) {
        notify('control:focus', body)
      },
      'control:close'(body) {
        notify('control:close', body)
      },
      'control:close-all'(body) {
        notify('control:close-all', body)
      },
      'control:ping'(body) {
        notify('control:ping', body)
      },
      'control:call'(body) {
        notify('control:call', body)
      }
    })
  } else {
    handle.expose({
      'child:ready'(body) {
        notify('child:ready', body)
      },
      'child:pong'(body) {
        notify('child:pong', body)
      },
      'child:log'(body) {
        notify('child:log', body)
      },
      'child:close-self'(body) {
        notify('child:close-self', body)
      }
    })
  }

  handle.on('closed', () => {
    deps?.log.info(
      `window closed id=${handle.id} role=${winSession.role} scenario=${winSession.scenario || '-'}`
    )
    deleteWinSession(handle.id)
    if (getControlWindowId() === handle.id) setControlWindowId(null)
    if (winSession.scenario) clearScenarioWindowId(winSession.scenario)

    for (const [key, pending] of pendingPings) {
      if (key.startsWith(`${handle.id}:`)) {
        clearTimeout(pending.timer)
        pending.reject(new BppError('INVALID_INPUT', `window ${handle.id} closed before pong`))
        pendingPings.delete(key)
      }
    }

    void notifyControl('winSessions', { winSessions: listWinSessions() })
    void notifyControl('log', {
      level: 'info',
      message: `closed #${handle.id} (${winSession.role}${
        winSession.scenario ? '/' + winSession.scenario : ''
      })`
    })
  })

  for (const eventName of ['focus', 'blur', 'show', 'hide', 'move', 'resize']) {
    handle.on(eventName, (payload) => {
      pushEvent(winSession, eventName, payload)
    })
  }

  return winSession
}

module.exports = {
  setBindDeps,
  bindWinSession,
  pushEvent,
  getPendingPings
}
