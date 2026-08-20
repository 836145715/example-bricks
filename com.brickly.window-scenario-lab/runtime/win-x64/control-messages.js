'use strict'

/**
 * 处理各窗 sendToParent 上来的 channel（创建时已 bind 到对应 WinSession）。
 */

const { listScenarioMeta } = require('./scenarios')
const { isAlive, getWinSession, listWinSessions } = require('./win-session-store')
const { notifyControl, notifyWinSession, flushPendingSends } = require('./notify')
const { pushEvent, getPendingPings } = require('./bind-win-session')
const {
  openScenario,
  openSuite,
  focusWinSession,
  closeWinSession,
  closeAll,
  pingWinSession
} = require('./open-windows')

/** @type {{ log: { warn: Function } } | null} */
let pluginRef = null

function setControlMessagesPlugin(plugin) {
  pluginRef = plugin
}

async function onWindowMessage(winSession, payload) {
  if (!payload || typeof payload !== 'object') return
  await flushPendingSends()

  const channel = payload.channel
  const args = Array.isArray(payload.args) ? payload.args : []
  const body = args[0] && typeof args[0] === 'object' ? args[0] : {}

  pushEvent(winSession, 'message', { channel, body })

  if (winSession.role === 'control') {
    await handleControlChannel(channel, body)
    return
  }
  await handleChildChannel(winSession, channel, body)
}

async function handleControlChannel(channel, body) {
  if (channel === 'control:refresh') {
    await notifyControl('scenarios', { scenarios: listScenarioMeta() })
    await notifyControl('winSessions', { winSessions: listWinSessions() })
    return
  }
  if (channel === 'control:open-scenario') {
    try {
      const result = await openScenario({
        scenario: body.scenario || 'standard',
        mode: body.mode || 'ensure',
        title: body.title
      })
      await notifyControl('log', {
        level: 'ok',
        message: `open-scenario → #${result.windowId} reused=${result.reused}`
      })
      await notifyControl('winSessions', { winSessions: listWinSessions() })
    } catch (err) {
      await notifyControl('log', { level: 'err', message: String(err.message || err) })
    }
    return
  }
  if (channel === 'control:open-suite') {
    try {
      const result = await openSuite({
        mode: body.mode || 'new',
        scenarios: body.scenarios
      })
      await notifyControl('log', {
        level: 'ok',
        message: `open-suite → ${result.opened.length} windows`
      })
      await notifyControl('winSessions', { winSessions: listWinSessions() })
    } catch (err) {
      await notifyControl('log', { level: 'err', message: String(err.message || err) })
    }
    return
  }
  if (channel === 'control:focus') {
    try {
      await focusWinSession(Number(body.windowId))
      await notifyControl('log', { level: 'ok', message: `focus #${body.windowId}` })
    } catch (err) {
      await notifyControl('log', { level: 'err', message: String(err.message || err) })
    }
    return
  }
  if (channel === 'control:close') {
    try {
      await closeWinSession(Number(body.windowId))
      await notifyControl('winSessions', { winSessions: listWinSessions() })
    } catch (err) {
      await notifyControl('log', { level: 'err', message: String(err.message || err) })
    }
    return
  }
  if (channel === 'control:close-all') {
    const closed = await closeAll(body.keepControl !== false)
    await notifyControl('log', { level: 'ok', message: `close-all → ${closed}` })
    await notifyControl('winSessions', { winSessions: listWinSessions() })
    return
  }
  if (channel === 'control:ping') {
    try {
      const pong = await pingWinSession(Number(body.windowId), body.text || 'ping')
      await notifyControl('log', {
        level: 'ok',
        message: `pong #${body.windowId}: ${JSON.stringify(pong)}`
      })
    } catch (err) {
      await notifyControl('log', { level: 'err', message: String(err.message || err) })
    }
    return
  }
  if (channel === 'control:call') {
    try {
      const target = getWinSession(Number(body.windowId))
      if (!target || !isAlive(target.handle)) {
        throw new Error(`window ${body.windowId} not open`)
      }
      const result = await target.handle.call(
        String(body.method || 'getBounds'),
        Array.isArray(body.args) ? body.args : []
      )
      await notifyControl('log', {
        level: 'ok',
        message: `call #${body.windowId}.${body.method} → ${JSON.stringify(result)}`
      })
    } catch (err) {
      await notifyControl('log', { level: 'err', message: String(err.message || err) })
    }
  }
}

async function handleChildChannel(winSession, channel, body) {
  if (channel === 'child:ready') {
    await notifyWinSession(winSession, 'child:hello', {
      windowId: winSession.handle.id,
      role: winSession.role,
      scenario: winSession.scenario,
      title: winSession.title
    })
    return
  }
  if (channel === 'child:pong') {
    const reqId = body.reqId
    if (!reqId) return
    const key = `${winSession.handle.id}:${reqId}`
    const pending = getPendingPings().get(key)
    if (!pending) return
    clearTimeout(pending.timer)
    getPendingPings().delete(key)
    pending.resolve({
      windowId: winSession.handle.id,
      scenario: winSession.scenario,
      text: body.text,
      at: Date.now()
    })
    return
  }
  if (channel === 'child:log') {
    await notifyControl('log', {
      level: 'info',
      message: `[#${winSession.handle.id}] ${body.message || ''}`
    })
    return
  }
  if (channel === 'child:close-self') {
    try {
      await winSession.handle.close()
    } catch (err) {
      pluginRef?.log.warn(`child close-self failed: ${err.message || err}`)
    }
  }
}

module.exports = {
  setControlMessagesPlugin,
  onWindowMessage
}
