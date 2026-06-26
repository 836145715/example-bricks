/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.reminder'
const POPUP_URL = 'ui/reminder.html'

const plugin = new BricklyRuntime({ brickId: BRICK_ID })

let profileConfig = {}
let nextTimer = null
let nextFireAt = null
let popup = null
let lastError = null

function boolValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return !['false', '0', 'no', 'off'].includes(value.toLowerCase())
  return Boolean(value)
}

function intValue(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback
}

function reminderConfig() {
  return {
    enabled: boolValue(profileConfig.enabled, true),
    intervalMinutes: Math.max(1, intValue(profileConfig.intervalMinutes, 30)),
    firstDelaySeconds: intValue(profileConfig.firstDelaySeconds, 0),
    title: String(profileConfig.title || '提醒'),
    message: String(profileConfig.message || '该处理这件事了。'),
    autoCloseSeconds: intValue(profileConfig.autoCloseSeconds, 12)
  }
}

function clearSchedule() {
  if (nextTimer) clearTimeout(nextTimer)
  nextTimer = null
  nextFireAt = null
}

function msUntil(date) {
  return Math.max(0, date.getTime() - Date.now())
}

function scheduleNext() {
  clearSchedule()
  lastError = null
  const config = reminderConfig()
  if (!config.enabled) return statusPayload()

  try {
    const delayMs =
      config.firstDelaySeconds > 0
        ? config.firstDelaySeconds * 1000
        : config.intervalMinutes * 60 * 1000
    const fireAt = new Date(Date.now() + delayMs)
    nextFireAt = fireAt
    nextTimer = setTimeout(() => {
      void fireReminder('schedule')
    }, delayMs)
    nextTimer.unref?.()
  } catch (error) {
    lastError = error && error.message ? error.message : String(error)
    plugin.log.error(`schedule failed: ${lastError}`)
  }

  return statusPayload()
}

async function fireReminder(source) {
  const config = reminderConfig()
  if (!config.enabled) return
  await showPopup(config, source)
  const delayMs = config.intervalMinutes * 60 * 1000
  nextFireAt = new Date(Date.now() + delayMs)
  nextTimer = setTimeout(() => {
    void fireReminder('schedule')
  }, delayMs)
  nextTimer.unref?.()
}

async function showPopup(config, source) {
  if (popup) {
    try {
      await popup.close()
    } catch {}
    popup = null
  }

  const width = 390
  const height = 178
  const handle = await plugin.ui.createBrowserWindow(POPUP_URL, {
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    title: config.title,
    focusable: true
  })
  popup = handle

  handle.on('closed', () => {
    if (popup && popup.id === handle.id) popup = null
  })

  await placeTopRight(handle, width, height)
  await handle.showInactive().catch(() => handle.show())
  await handle.webContents.send('reminder:show', {
    title: config.title,
    message: config.message,
    source,
    firedAt: new Date().toISOString(),
    autoCloseSeconds: config.autoCloseSeconds
  })

  if (config.autoCloseSeconds > 0) {
    setTimeout(() => {
      if (popup && popup.id === handle.id) {
        handle.close().catch(() => {})
      }
    }, config.autoCloseSeconds * 1000).unref?.()
  }

  return { windowId: handle.id }
}

async function placeTopRight(handle, width, height) {
  try {
    await handle.center()
    const bounds = await handle.getBounds()
    const screen = await handle.webContents.executeJavaScript(
      '({ width: screen.availWidth, height: screen.availHeight, left: screen.availLeft || 0, top: screen.availTop || 0 })'
    )
    const x = Math.round((screen.left || 0) + (screen.width || bounds.width) - width - 20)
    const y = Math.round((screen.top || 0) + 20)
    await handle.setBounds({ x, y, width, height })
  } catch (error) {
    plugin.log.warn(`placeTopRight failed: ${error && error.message ? error.message : error}`)
  }
}

function statusPayload() {
  const config = reminderConfig()
  return {
    pid: process.pid,
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    firstDelaySeconds: config.firstDelaySeconds,
    title: config.title,
    autoCloseSeconds: config.autoCloseSeconds,
    nextFireAt: nextFireAt ? nextFireAt.toISOString() : null,
    millisecondsUntilNext: nextFireAt ? msUntil(nextFireAt) : null,
    popupWindowId: popup ? popup.id : null,
    lastError
  }
}

plugin.transport.on('message', (message) => {
  if (message && message.type === 'host.hello') {
    profileConfig = message.config || {}
    scheduleNext()
  }
})

plugin.events.on('window.message', async (payload) => {
  if (!payload || !popup || payload.windowId !== popup.id) return
  if (payload.channel === 'reminder:close') {
    await popup.close().catch(() => {})
    popup = null
  }
})

plugin.onReady(() => {
  scheduleNext()
})

plugin.onCommand('status', async (ctx) => {
  const status = statusPayload()
  ctx.output('status', status)
  return status
})

plugin.onCommand('preview', async (ctx) => {
  const result = await showPopup(reminderConfig(), 'preview')
  ctx.output('window', result)
  return result
})

plugin.onCommand('reschedule', async (ctx) => {
  const status = scheduleNext()
  ctx.output('status', status)
  return status
})

plugin.onShutdown(async () => {
  clearSchedule()
  if (popup) await popup.close().catch(() => {})
})

plugin.start()
