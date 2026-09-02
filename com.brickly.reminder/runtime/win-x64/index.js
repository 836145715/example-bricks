'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const POPUP_URL = 'ui/reminder.html'
const POPUP_WIDTH = 340
const POPUP_HEIGHT = 152

const brick = new BricklyRuntime()

let timer = null
let popup = null
let cfg = readCfg({})

function boolValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return !['false', '0', 'no', 'off'].includes(value.toLowerCase())
  return Boolean(value)
}

function intValue(value, fallback, min = 0) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? Math.max(min, n) : fallback
}

function readCfg(config) {
  const src = config && typeof config === 'object' ? config : {}
  return {
    enabled: boolValue(src.enabled, true),
    intervalMinutes: intValue(src.intervalMinutes, 30, 1),
    firstDelaySeconds: intValue(src.firstDelaySeconds, 0),
    title: String(src.title || '提醒'),
    message: String(src.message || '该处理这件事了。'),
    autoCloseSeconds: intValue(src.autoCloseSeconds, 12)
  }
}

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

/** 到期后必须 invoke 自己的 standalone 命令再开窗，不能在定时器里 createWindow。 */
function arm(delayMs) {
  clearTimer()
  if (!cfg.enabled) return
  timer = setTimeout(() => {
    brick
      .invoke('preview', { source: 'schedule' })
      .catch((error) => {
        brick.log.error('fire reminder failed', error)
      })
      .finally(() => {
        if (cfg.enabled) arm(cfg.intervalMinutes * 60 * 1000)
      })
  }, delayMs)
  timer.unref?.()
}

function armFirst() {
  const delayMs =
    cfg.firstDelaySeconds > 0 ? cfg.firstDelaySeconds * 1000 : cfg.intervalMinutes * 60 * 1000
  return arm(delayMs)
}

function injectedConfig() {
  try {
    const parsed = JSON.parse(process.env.BRICKLY_PROFILE_CONFIG || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function placeTopRight(ctx, win) {
  try {
    const display = await ctx.platform.screen.getPrimaryDisplay()
    const area = display.workArea || display.bounds
    const x = Math.round((area.x || 0) + (area.width || POPUP_WIDTH) - POPUP_WIDTH - 20)
    const y = Math.round((area.y || 0) + 20)
    await win.setPosition(x, y)
  } catch (error) {
    brick.log.warn('placeTopRight failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function showToast(ctx) {
  if (popup) {
    await popup.close().catch(() => {})
    popup = null
  }

  const win = await ctx.ui.createBrowserWindow(POPUP_URL, {
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: true,
    lifetime: 'standalone',
    title: cfg.title,
    focusable: true
  })
  popup = win
  win.expose({
    close() {
      void win.close().catch(() => {})
    }
  })
  win.on('closed', () => {
    if (popup === win) popup = null
  })

  await placeTopRight(ctx, win)
  await win.showInactive().catch(() => win.show())
  const payload = {
    title: cfg.title,
    message: cfg.message,
    intervalMinutes: cfg.intervalMinutes,
    autoCloseSeconds: cfg.autoCloseSeconds
  }
  await win.send('show', payload)
  setTimeout(() => {
    if (popup === win) void win.send('show', payload).catch(() => {})
  }, 250).unref?.()
  if (cfg.autoCloseSeconds > 0) {
    setTimeout(() => {
      if (popup === win) void win.close().catch(() => {})
    }, cfg.autoCloseSeconds * 1000).unref?.()
  }

  return { windowId: win.id }
}

brick.onReady(() => {
  cfg = readCfg(injectedConfig())
  armFirst()
})

brick.onCommand('preview', async (ctx, input) => {
  cfg = readCfg(ctx.config)
  const result = await showToast(ctx)
  const scheduled = Boolean(input && input.source === 'schedule')
  if (!scheduled) arm(cfg.intervalMinutes * 60 * 1000)
  return result
})

brick.onShutdown(async () => {
  clearTimer()
  if (popup) await popup.close().catch(() => {})
})

brick.start()
