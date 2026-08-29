/* eslint-disable */
'use strict'

const { BricklyRuntime, call } = require('@syllm/brickly-sdk')
const {
  selectedTextFromSnapshots,
  clipboardContentFromSnapshot,
  normalizeOcrText
} = require('./lib/text-input')

const BRICK_ID = 'com.brickly.context-pilot'
const WINDOW_HTML = 'ui/index.html'
const COPY_SETTLE_MS = 300
const WINDOW_WIDTH = 560
const WINDOW_INITIAL_HEIGHT = 420
const WINDOW_MIN_HEIGHT = 260
const WINDOW_MAX_HEIGHT = 720
const WINDOW_MARGIN = 16
const CURSOR_OFFSET = { x: 18, y: 22 }
const FADE_STEPS = [0.12, 0.32, 0.58, 0.82, 1]
const COPY_MODIFIER = process.platform === 'darwin' ? 'meta' : 'control'

const plugin = new BricklyRuntime()

let panelWindow = null
let panelWindowBounds = null

async function runAnalyzeSelection(ctx) {
  const before = await safeReadClipboard(ctx)
  await copySelection(ctx)
  await sleep(COPY_SETTLE_MS)

  const after = await safeReadClipboard(ctx)
  const selection = selectedTextFromSnapshots(before, after)
  logClipboardDecision(selection, before, after)
  await restoreClipboard(ctx, before)
  if (!selection.text) {
    return { analyzed: false, reason: selection.reason }
  }

  return analyzeSourceText(ctx, selection.text, { source: 'selection' })
}

async function runAnalyzeScreenshot(ctx) {
  const ocrResult = await call(ctx.dependencies.require('ocr'), 'capture-text', {
    languageType: 'AUTO',
    probability: false,
    keepScreenshot: false
  }, {
    signal: ctx.signal,
    onEvent() {}
  })
  const sourceText = normalizeOcrText(ocrResult)
  if (!sourceText) {
    return { analyzed: false, reason: 'ocr-empty-text', ocrResult }
  }

  return analyzeSourceText(ctx, sourceText, {
    source: 'screenshot',
    ocrResult
  })
}

plugin.onCommand('analyze-selection', async (ctx) => runAnalyzeSelection(ctx))
plugin.onCommand('analyze-screenshot', async (ctx) => runAnalyzeScreenshot(ctx))

async function analyzeSourceText(ctx, sourceText, options = {}) {
  let cancelled = false
  ctx.onCancel(() => {
    cancelled = true
  })
  const ensureActive = () => {
    if (cancelled || ctx.isCancelled() || ctx.signal?.aborted) {
      throw cancelledError()
    }
  }

  ensureActive()
  const win = await ensurePanelWindow(ctx)
  ensureActive()
  await sendToWindow(win, 'context-pilot:start', {
    requestId: ctx.requestId,
    source: options.source || 'selection',
    sourceText,
    startedAt: Date.now()
  })

  try {
    ensureActive()
    const markdown = await analyzeWithOpenAI(ctx, sourceText, win, ensureActive)
    ensureActive()
    await sendToWindow(win, 'context-pilot:result', {
      requestId: ctx.requestId,
      source: options.source || 'selection',
      sourceText,
      markdown,
      completedAt: Date.now()
    })
    const result = { analyzed: true, source: options.source || 'selection', sourceText, markdown }
    if (options.ocrResult) result.ocrResult = options.ocrResult
    return result
  } catch (error) {
    if (isCancelledError(error) || cancelled || ctx.isCancelled() || ctx.signal?.aborted) {
      throw cancelledError()
    }
    const payload = {
      requestId: ctx.requestId,
      source: options.source || 'selection',
      sourceText,
      error: errorMessage(error),
      failedAt: Date.now()
    }
    await sendToWindow(win, 'context-pilot:error', payload).catch(() => {})
    throw error
  }
}

plugin.onShutdown(async () => {
  if (panelWindow && !panelWindow.closed) {
    await panelWindow.close().catch(() => {})
  }
  panelWindow = null
})

plugin.start()

async function copySelection(ctx) {
  await ctx.platform.input.keyboardTap('c', COPY_MODIFIER)
}

async function safeReadClipboard(ctx) {
  try {
    return await ctx.platform.clipboard.readContent()
  } catch (error) {
    plugin.log.warn(`read clipboard failed: ${errorMessage(error)}`)
    return { capturedAt: Date.now() }
  }
}

function logClipboardDecision(selection, before, after) {
  plugin.log.debug(
    [
      `selection=${selection.reason}`,
      `before=${snapshotSummary(before)}`,
      `after=${snapshotSummary(after)}`
    ].join(' ')
  )
}

function snapshotSummary(snapshot) {
  if (!snapshot) return 'none'
  const textLength = typeof snapshot.text === 'string' ? snapshot.text.trim().length : 0
  return `{kind:${snapshot.kind || 'unknown'},hash:${snapshot.hash || 'none'},textLength:${textLength}}`
}

async function restoreClipboard(ctx, snapshot) {
  const content = clipboardContentFromSnapshot(snapshot)
  if (!content) return
  try {
    await ctx.platform.clipboard.setContent(content)
  } catch (error) {
    plugin.log.warn(`restore clipboard failed: ${errorMessage(error)}`)
  }
}


async function ensurePanelWindow(ctx) {
  if (panelWindow && !panelWindow.closed) {
    await panelWindow.setOpacity(0).catch(() => {})
    await panelWindow.showInactive().catch(() => panelWindow.show())
    await panelWindow.focus().catch(() => {})
    await animateWindowIn(panelWindow)
    return panelWindow
  }

  const bounds = await getPopupBounds(ctx)
  panelWindow = await plugin.ui.createBrowserWindow(WINDOW_HTML, {
    ...bounds,
    minWidth: 460,
    minHeight: WINDOW_MIN_HEIGHT,
    maxHeight: WINDOW_MAX_HEIGHT,
    title: 'Brickly · ContextPilot',
    frame: false,
    transparent: true,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    opacity: 0,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    autoHideMenuBar: true
  })
  panelWindow.on('closed', () => {
    panelWindow = null
    panelWindowBounds = null
  })
  panelWindow.expose({
    'context-pilot:close'() {
      void closePanelWindow()
    },
    'context-pilot:resize'(payload) {
      void resizePanelWindow(ctx, payload)
    }
  })
  await panelWindow.showInactive().catch(() => panelWindow.show())
  await panelWindow.focus().catch(() => {})
  await animateWindowIn(panelWindow)
  return panelWindow
}

async function closePanelWindow() {
  if (!panelWindow || panelWindow.closed) return
  const win = panelWindow
  panelWindow = null
  await win.close().catch(() => {})
}

async function resizePanelWindow(ctx, payload) {
  if (!panelWindow || panelWindow.closed) return
  const requestedHeight = Number(payload?.height)
  if (!Number.isFinite(requestedHeight)) return
  const current = panelWindowBounds || (await getPopupBounds(ctx))
  const next = await clampPopupBounds(ctx, {
    ...current,
    height: clamp(requestedHeight, WINDOW_MIN_HEIGHT, WINDOW_MAX_HEIGHT)
  })
  if (next.height === current.height && next.y === current.y) return
  panelWindowBounds = next
  await panelWindow.setBounds(next).catch(() => {})
}

async function getPopupBounds(ctx) {
  const cursor = await ctx.platform.screen
    .getCursorScreenPoint()
    .catch(() => ({ x: 160, y: 160 }))
  const display = await ctx.platform.screen
    .getDisplayNearestPoint(cursor)
    .catch(() => ({
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  const workArea = display.workArea || display.bounds || { x: 0, y: 0, width: 1440, height: 900 }
  const width = WINDOW_WIDTH
  const height = WINDOW_INITIAL_HEIGHT
  const preferRight = cursor.x + CURSOR_OFFSET.x + width <= workArea.x + workArea.width - WINDOW_MARGIN
  const preferBelow = cursor.y + CURSOR_OFFSET.y + height <= workArea.y + workArea.height - WINDOW_MARGIN
  const rawX = preferRight ? cursor.x + CURSOR_OFFSET.x : cursor.x - width - CURSOR_OFFSET.x
  const rawY = preferBelow ? cursor.y + CURSOR_OFFSET.y : cursor.y - height - CURSOR_OFFSET.y
  const bounds = {
    x: clamp(rawX, workArea.x + WINDOW_MARGIN, workArea.x + workArea.width - width - WINDOW_MARGIN),
    y: clamp(rawY, workArea.y + WINDOW_MARGIN, workArea.y + workArea.height - height - WINDOW_MARGIN),
    width,
    height
  }
  panelWindowBounds = bounds
  return bounds
}

async function clampPopupBounds(ctx, bounds) {
  const anchorPoint = {
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2)
  }
  const cursor = await ctx.platform.screen
    .getCursorScreenPoint()
    .then(() => anchorPoint)
    .catch(() => anchorPoint)
  const display = await ctx.platform.screen
    .getDisplayNearestPoint(cursor)
    .catch(() => ({
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  const workArea = display.workArea || display.bounds || { x: 0, y: 0, width: 1440, height: 900 }
  return {
    ...bounds,
    x: clamp(bounds.x, workArea.x + WINDOW_MARGIN, workArea.x + workArea.width - bounds.width - WINDOW_MARGIN),
    y: clamp(bounds.y, workArea.y + WINDOW_MARGIN, workArea.y + workArea.height - bounds.height - WINDOW_MARGIN)
  }
}

async function animateWindowIn(win) {
  for (const opacity of FADE_STEPS) {
    await win.setOpacity(opacity).catch(() => {})
    await sleep(18)
  }
}

function clamp(value, min, max) {
  if (max < min) return min
  return Math.min(Math.max(Math.round(value), min), max)
}

async function sendToWindow(win, channel, payload) {
  await win.send(channel, payload)
}

async function analyzeWithOpenAI(ctx, sourceText, win, ensureActive) {
  const input = {
    model: undefined,
    messages: [
      {
        role: 'system',
        content: [
          '你是 ContextPilot，一个面向程序员和技术文档读者的英文句子解构助手。',
          '只输出协议化 Markdown，不输出 JSON，不要包裹代码块。',
          '必须按以下 section 顺序输出，标题原样保留：',
          '[SECTION:natural_translation]',
          '[SECTION:literal_translation]',
          '[SECTION:skeleton]',
          '[SECTION:chunks]',
          '[SECTION:patterns]',
          '每个 section 内容要短、准、偏技术语境。'
        ].join('\n')
      },
      {
        role: 'user',
        content: buildAnalysisPrompt(sourceText)
      }
    ],
    stream: true,
    temperature: 0.2
  }
  let streamedMarkdown = ''
  const result = await call(ctx.dependencies.require('openai'), 'chat-completions', input, {
    signal: ctx.signal,
    onEvent: async (event) => {
      ensureActive()
      if (!event || typeof event !== 'object') return
      if (event.type === 'chunk' && event.name === 'text' && typeof event.chunk === 'string') {
        streamedMarkdown += event.chunk
        await sendToWindow(win, 'context-pilot:delta', {
          requestId: ctx.requestId,
          delta: event.chunk,
          markdown: streamedMarkdown,
          updatedAt: Date.now()
        }).catch(() => {})
      }
    }
  })
  ensureActive()
  const text = extractText(result)
  const markdown = text || streamedMarkdown
  if (!markdown) throw new Error('OpenAI 未返回可用解构内容')
  return markdown.trim()
}

function buildAnalysisPrompt(sourceText) {
  return [
    '请解构下面这段英文技术文本。输出必须使用协议化 Markdown，section 标题保持英文标签。',
    '',
    '输出格式：',
    '[SECTION:natural_translation]',
    '自然、准确的简体中文意译。',
    '',
    '[SECTION:literal_translation]',
    '尽量保留英文结构的直译，帮助学习者对齐语序。',
    '',
    '[SECTION:skeleton]',
    'S: 主语',
    'V: 谓语/核心动作',
    'O/C: 宾语或补足语',
    'Core: 用一句极简英文写出主干。',
    '',
    '[SECTION:chunks]',
    '- `原文片段`: 语法角色；中文解释；为什么它放在这里。',
    '',
    '[SECTION:patterns]',
    '- Formula: [技术名词] for doing something',
    '  Meaning: 用于做某事的技术对象。',
    '  Examples: APIs for retrieving documents; tools for interacting with databases.',
    '',
    '约束：',
    '- 不要输出 JSON。',
    '- 不要输出代码块围栏。',
    '- 不要讲泛泛语法课，要贴近技术文档阅读。',
    '- 如果文本不是完整句子，也照样按短语/片段解构。',
    '',
    `英文文本：\n${sourceText}`
  ].join('\n')
}

function extractText(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.output_text === 'string') return value.output_text
  if (value.result && typeof value.result === 'object') return extractText(value.result)
  if (value.response && typeof value.response === 'object') return extractText(value.response)
  return ''
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message) return error.message
    return stringifyErrorObject(error) || String(error)
  }
  return String(error)
}

function cancelledError() {
  const error = new Error('Invocation cancelled by host')
  error.code = 'CANCELLED'
  return error
}

function isCancelledError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error.code === 'CANCELLED' ||
        error.message === 'Invocation cancelled by host' ||
        error.message === 'aborted')
  )
}

function stringifyErrorObject(value) {
  const seen = new WeakSet()
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString()
      if (!item || typeof item !== 'object') return item
      if (seen.has(item)) return '[Circular]'
      seen.add(item)
      return item
    })
  } catch {
    return ''
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
