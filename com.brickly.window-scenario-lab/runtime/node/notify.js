'use strict'

/**
 * 向控制台 / 子窗推送消息（webContents.send）。
 *
 * ALS 规则：
 * - 在 command/event 上下文内：payload 不要自带不同的 requestId
 * - 不在上下文：send 会失败 → 入队，等下次 window.message 再 flush
 */

const {
  isAlive,
  getControlWindowId,
  getWinSession,
  getControlWinSession
} = require('./win-session-store')

/** @type {Array<{ target: 'control'|'winSession', windowId?: number, channel: string, payload: unknown }>} */
const pendingSends = []

/** @type {{ log: { warn: (m: string) => void } } | null} */
let pluginRef = null

function setNotifyPlugin(plugin) {
  pluginRef = plugin
}

function isMissingParentRequestError(err) {
  const msg = String(err && err.message ? err.message : err)
  return (
    msg.includes('PARENT_INVOCATION_REQUIRED') ||
    msg.includes('must run inside command/event') ||
    msg.includes('requestId')
  )
}

async function rawSend(handle, channel, payload) {
  const body =
    payload != null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : { value: payload }
  await handle.webContents.send(channel, body)
}

async function notifyControl(channel, payload) {
  const winSession = getControlWinSession()
  if (!winSession || !isAlive(winSession.handle)) return
  try {
    await rawSend(winSession.handle, channel, payload)
  } catch (err) {
    if (isMissingParentRequestError(err)) {
      pendingSends.push({ target: 'control', channel, payload })
      return
    }
    pluginRef?.log.warn(`notifyControl ${channel} failed: ${err.message || err}`)
  }
}

async function notifyWinSession(winSession, channel, payload) {
  if (!isAlive(winSession.handle)) return
  try {
    await rawSend(winSession.handle, channel, payload)
  } catch (err) {
    if (isMissingParentRequestError(err)) {
      pendingSends.push({
        target: 'winSession',
        windowId: winSession.handle.id,
        channel,
        payload
      })
      return
    }
    pluginRef?.log.warn(
      `notifyWinSession ${winSession.handle.id} ${channel} failed: ${err.message || err}`
    )
  }
}

/** 在 window.message（有 ALS）里调用 */
async function flushPendingSends() {
  if (!pendingSends.length) return
  const batch = pendingSends.splice(0, pendingSends.length)
  for (const item of batch) {
    try {
      if (item.target === 'control') {
        const winSession = getControlWinSession()
        if (winSession && isAlive(winSession.handle)) {
          await rawSend(winSession.handle, item.channel, item.payload)
        }
      } else if (item.windowId != null) {
        const winSession = getWinSession(item.windowId)
        if (winSession && isAlive(winSession.handle)) {
          await rawSend(winSession.handle, item.channel, item.payload)
        }
      }
    } catch (err) {
      pluginRef?.log.warn(`flushPendingSends ${item.channel} failed: ${err.message || err}`)
    }
  }
}

module.exports = {
  setNotifyPlugin,
  notifyControl,
  notifyWinSession,
  flushPendingSends,
  // 仅测试/调试
  _pendingSends: pendingSends,
  getControlWindowId
}
