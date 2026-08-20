/* eslint-disable */
'use strict'

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

const brick = new BricklyRuntime({ brickId: 'com.brickly.input-demo' })

function log(message, details) {
  brick.log.info(message, details)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForStart(ctx, delayMs) {
  const delay = clampNumber(delayMs, 0, 10000, 0)
  if (delay <= 0) return
  const startedAt = Date.now()
  while (Date.now() - startedAt < delay) {
    ensureNotCancelled(ctx)
    const elapsed = Date.now() - startedAt
    ctx.progress(
      Math.min(elapsed / delay, 0.95),
      `请把焦点切到目标窗口，${Math.ceil((delay - elapsed) / 1000)} 秒后执行`
    )
    await sleep(Math.min(250, delay - elapsed))
  }
}

async function keyboardTap(ctx, key, modifiers = []) {
  ensureNotCancelled(ctx)
  await ctx.platform.input.keyboardTap({ key, modifiers })
}

async function runKeyboardTap(ctx, input) {
  const key = nonEmptyString(input.key, 'a')
  const modifiers = parseModifiers(input.modifiers)
  const repeat = Math.floor(clampNumber(input.repeat, 1, 20, 1))
  const intervalMs = clampNumber(input.intervalMs, 20, 2000, 120)
  await waitForStart(ctx, input.delayMs)

  for (let i = 0; i < repeat; i++) {
    ensureNotCancelled(ctx)
    await keyboardTap(ctx, key, modifiers)
    ctx.progress((i + 1) / repeat, `已发送 ${i + 1}/${repeat}: ${formatKey(key, modifiers)}`)
    if (i + 1 < repeat) await sleep(intervalMs)
  }

  return {
    action: 'keyboardTap',
    key,
    modifiers,
    repeat,
    finishedAt: Date.now()
  }
}

async function runTypeText(ctx, input) {
  const text = String(input.text ?? 'hello brickly 123')
  const intervalMs = clampNumber(input.intervalMs, 20, 1000, 80)
  await waitForStart(ctx, input.delayMs)

  const taps = [...text].map(charToTap)
  for (let i = 0; i < taps.length; i++) {
    ensureNotCancelled(ctx)
    const tap = taps[i]
    await keyboardTap(ctx, tap.key, tap.modifiers)
    ctx.progress((i + 1) / taps.length, `已输入 ${i + 1}/${taps.length}`)
    ctx.chunk(tap.display)
    if (i + 1 < taps.length) await sleep(intervalMs)
  }

  return {
    action: 'typeText',
    text,
    chars: taps.length,
    finishedAt: Date.now()
  }
}

async function runMouseAction(ctx, input) {
  const action = nonEmptyString(input.action, 'move')
  const x = Math.round(clampNumber(input.x, -10000, 10000, 100))
  const y = Math.round(clampNumber(input.y, -10000, 10000, 100))
  await waitForStart(ctx, input.delayMs)

  const actionByName = {
    move: ctx.platform.input.mouseMove,
    'left-click': ctx.platform.input.mouseClick,
    'double-click': ctx.platform.input.mouseDoubleClick,
    'right-click': ctx.platform.input.mouseRightClick
  }
  const run = actionByName[action]
  if (!run) {
    throw new BppError('INVALID_INPUT', `未知鼠标动作: ${action}`)
  }
  await run({ x, y })
  ctx.progress(1, `已执行 ${action} @ (${x}, ${y})`)
  return {
    action,
    x,
    y,
    finishedAt: Date.now()
  }
}

function charToTap(ch) {
  if (ch === ' ') return { key: 'space', modifiers: [], display: ' ' }
  if (ch === '\n') return { key: 'enter', modifiers: [], display: '\n' }
  if (ch === '\t') return { key: 'tab', modifiers: [], display: '\t' }
  if (/^[A-Z]$/.test(ch)) {
    return { key: ch.toLowerCase(), modifiers: ['shift'], display: ch }
  }
  return { key: ch, modifiers: [], display: ch }
}

function parseModifiers(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value ?? '')
    .split(/[,+\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function nonEmptyString(value, fallback) {
  const text = String(value ?? '').trim()
  return text || fallback
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function formatKey(key, modifiers) {
  return [...modifiers, key].join('+')
}

function ensureNotCancelled(ctx) {
  if (ctx.isCancelled()) {
    throw new BppError('CANCELLED', '已取消')
  }
}

brick.onCommand('keyboard-tap', async (ctx, input = {}) => {
  log('invoke start', { id: ctx.requestId, commandId: ctx.commandId })
  const result = await runKeyboardTap(ctx, input)
  log('invoke result', { id: ctx.requestId, commandId: ctx.commandId })
  return result
})

brick.onCommand('type-text', async (ctx, input = {}) => {
  log('invoke start', { id: ctx.requestId, commandId: ctx.commandId })
  const result = await runTypeText(ctx, input)
  log('invoke result', { id: ctx.requestId, commandId: ctx.commandId })
  return result
})

brick.onCommand('mouse-action', async (ctx, input = {}) => {
  log('invoke start', { id: ctx.requestId, commandId: ctx.commandId })
  const result = await runMouseAction(ctx, input)
  log('invoke result', { id: ctx.requestId, commandId: ctx.commandId })
  return result
})

brick.start()
