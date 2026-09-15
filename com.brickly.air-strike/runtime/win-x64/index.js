/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const brick = new BricklyRuntime()
const OVERLAY_URL = 'ui/overlay.html'
const AIM_TIMEOUT_MS = 60000

// shared 实例 + execution:parallel 下，热键再按一次 = 顶掉正在进行的瞄准。
// dead：被后续 run 取代（可能还没开成窗）；resolved：命令已结算（promise 只会 resolve 一次）。
let activeRun = null

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function closeRunWindow(run) {
  if (!run || !run.win || run.win.isClosed) return Promise.resolve()
  return run.win.close().catch(() => run.win.forceClose().catch(() => {}))
}

function supersede(run) {
  if (!run) return Promise.resolve()
  run.dead = true
  if (run.timeout) clearTimeout(run.timeout)
  // 有窗则关窗，'closed' 事件会把那局命令按取消结算；没窗说明还在创建中，
  // 对方创建完成后会自查 dead 标记自行退出。
  return closeRunWindow(run)
}

brick.onCommand('strike', async (ctx, input = {}) => {
  const run = { win: null, dead: false, resolved: false, timeout: null }
  const previous = activeRun
  activeRun = run
  await supersede(previous)

  const point = await ctx.platform.screen.getCursorScreenPoint()
  const display = await ctx.platform.screen.getDisplayNearestPoint(point)
  const bounds = display.bounds

  const options = {
    lockDelayMs: clampNumber(input.lockDelayMs, 200, 5000, 800),
    mute: Boolean(input.mute)
  }

  const win = await ctx.ui.createBrowserWindow(OVERLAY_URL, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    title: 'Brickly · 空袭准星',
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    focusable: true,
    show: true
  })
  run.win = win
  if (run.dead) {
    // 等待开窗期间已被下一局顶掉
    await closeRunWindow(run)
    return { exploded: false, cancelled: true, reason: 'superseded' }
  }

  const result = await new Promise((resolve) => {
    const finish = (value) => {
      if (run.resolved) return
      run.resolved = true
      run.dead = true
      if (run.timeout) clearTimeout(run.timeout)
      if (activeRun === run) activeRun = null
      resolve(value)
    }
    run.timeout = setTimeout(() => finish({ exploded: false, cancelled: true, reason: 'aim-timeout' }), AIM_TIMEOUT_MS)

    win.expose({
      'strike:init': () => ({ options }),
      // 锁定后立刻穿透鼠标：导弹动画期间桌面恢复可操作
      'strike:locked': () => void win.setIgnoreMouseEvents(true),
      'strike:done': (payload) => {
        const local = payload && payload.target
        const target =
          local && Number.isFinite(local.x) && Number.isFinite(local.y)
            ? { x: Math.round(bounds.x + local.x), y: Math.round(bounds.y + local.y) }
            : null
        finish({ exploded: true, cancelled: false, target })
      },
      'strike:cancel': () => finish({ exploded: false, cancelled: true })
    })
    // 命令被取消 / 宿主关窗 / 页面崩溃，都按取消结算；Call 绑定窗随命令终态自动回收。
    win.once('closed', () => finish({ exploded: false, cancelled: true, reason: 'window-closed' }))
  })

  // 给页面的淡出动画留一点时间再关窗
  if (result.exploded) await new Promise((r) => setTimeout(r, 400))
  await closeRunWindow(run)
  return result
})

brick.start()
