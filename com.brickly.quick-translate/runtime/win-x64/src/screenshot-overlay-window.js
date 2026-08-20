/* eslint-disable */
'use strict'

const OVERLAY_URL = 'ui/overlay.html'
const RENDER_CHANNEL = 'quick-translate-overlay:render'
const READY_CHANNEL = 'quick-translate-overlay:ready'
const CLOSE_CHANNEL = 'quick-translate-overlay:close'

let overlayWindow = null

async function openScreenshotOverlayWindow(ctx, payload) {
  await closeScreenshotOverlayWindow()
  const bounds = normalizeBounds(payload.bounds, payload.width, payload.height)
  const win = await ctx.ui.createBrowserWindow(OVERLAY_URL, {
    ...bounds,
    title: 'Brickly · 截图翻译',
    frame: false,
    transparent: true,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    autoHideMenuBar: true,
    focusable: true
  })

  overlayWindow = win
  const timers = []
  const send = () => sendScreenshotOverlay(win, payload)
  const onMessage = (message) => {
    if (!message) return
    if (message.channel === READY_CHANNEL) {
      void send()
      return
    }
    if (message.channel === CLOSE_CHANNEL) {
      void closeScreenshotOverlayWindow()
    }
  }

  win.on('message', onMessage)
  win.once('closed', () => {
    if (overlayWindow === win) overlayWindow = null
    win.off('message', onMessage)
    for (const timer of timers) clearTimeout(timer)
  })

  await win.show().catch(() => win.showInactive())
  await win.focus().catch(() => {})
  await send()
  for (const delay of [250, 800]) {
    timers.push(setTimeout(() => void send(), delay))
  }

  return win
}

async function closeScreenshotOverlayWindow() {
  if (!overlayWindow || overlayWindow.closed) {
    overlayWindow = null
    return
  }
  const win = overlayWindow
  overlayWindow = null
  await win.close().catch(() => {})
}

async function sendScreenshotOverlay(win, payload) {
  try {
    await win.call('webContents.send', [RENDER_CHANNEL, payload])
    return true
  } catch {
    return false
  }
}

function normalizeBounds(bounds, fallbackWidth, fallbackHeight) {
  const width = positiveNumber(bounds?.width) || positiveNumber(fallbackWidth) || 640
  const height = positiveNumber(bounds?.height) || positiveNumber(fallbackHeight) || 360
  return {
    x: finiteNumber(bounds?.x) ?? 0,
    y: finiteNumber(bounds?.y) ?? 0,
    width: Math.round(width),
    height: Math.round(height)
  }
}

function positiveNumber(value) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined
}

function finiteNumber(value) {
  return Number.isFinite(value) ? Math.round(Number(value)) : undefined
}

module.exports = {
  openScreenshotOverlayWindow,
  closeScreenshotOverlayWindow,
  sendScreenshotOverlay,
  OVERLAY_URL,
  RENDER_CHANNEL,
  READY_CHANNEL,
  CLOSE_CHANNEL
}
