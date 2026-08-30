'use strict'

/**
 * 向控制台 / 子窗推送消息（win.send → 页面 on）。
 */

const { isAlive, getWinSession, getControlWinSession } = require('./win-session-store')

/** @type {{ log: { warn: (m: string) => void } } | null} */
let pluginRef = null

function setNotifyPlugin(plugin) {
  pluginRef = plugin
}

async function rawSend(handle, channel, payload) {
  const body =
    payload != null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : { value: payload }
  await handle.send(channel, body)
}

async function notifyControl(channel, payload) {
  const winSession = getControlWinSession()
  if (!winSession || !isAlive(winSession.handle)) return
  try {
    await rawSend(winSession.handle, channel, payload)
  } catch (err) {
    pluginRef?.log.warn(`notifyControl ${channel} failed: ${err.message || err}`)
  }
}

async function notifyWinSession(winSession, channel, payload) {
  if (!isAlive(winSession.handle)) return
  try {
    await rawSend(winSession.handle, channel, payload)
  } catch (err) {
    pluginRef?.log.warn(
      `notifyWinSession ${winSession.handle.id} ${channel} failed: ${err.message || err}`
    )
  }
}

module.exports = {
  setNotifyPlugin,
  notifyControl,
  notifyWinSession
}
