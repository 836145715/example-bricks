/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { renderScreenshotOverlay } = require('./src/screenshot-overlay-renderer')
const {
  openScreenshotOverlayWindow,
  closeScreenshotOverlayWindow
} = require('./src/screenshot-overlay-window')

const BRICK_ID = 'com.brickly.quick-translate'
const WINDOW_HTML = 'ui/index.html'
const COPY_SETTLE_MS = 300
const MAX_SOURCE_CHARS = 8000
const WINDOW_WIDTH = 360
const WINDOW_INITIAL_HEIGHT = 138
const WINDOW_MIN_HEIGHT = 118
const WINDOW_MAX_HEIGHT = 300
const WINDOW_MARGIN = 16
const CURSOR_OFFSET = { x: 18, y: 22 }
const FADE_STEPS = [0.12, 0.32, 0.58, 0.82, 1]
const SCREENSHOT_LANGUAGE = 'AUTO'
const DEBUG_LOG_FILE = path.join(os.tmpdir(), 'brickly-quick-translate', 'debug.log')

const plugin = new BricklyRuntime({ brickId: BRICK_ID })

let translateWindow = null
let translateWindowBounds = null

plugin.onCommand('translate-selection', async (ctx) => {
  ctx.progress(0.05, '读取剪贴板快照')
  const before = await safeReadClipboard(ctx)

  ctx.progress(0.15, '复制当前选区')
  await ctx.platform.input.keyboardTap('c', 'control')
  await sleep(COPY_SETTLE_MS)

  ctx.progress(0.3, '检测选中文本')
  const after = await safeReadClipboard(ctx)
  const selection = selectedTextFromSnapshots(before, after)
  logClipboardDecision(selection, before, after)
  await restoreClipboard(ctx, before)
  if (!selection.text) {
    return { translated: false, reason: selection.reason }
  }

  const win = await ensureTranslateWindow(ctx)
  await sendToWindow(win, 'translate:start', {
    sourceText: selection.text,
    startedAt: Date.now()
  })

  try {
    ctx.progress(0.45, '调用 OpenAI 翻译')
    const translatedText = await translateWithOpenAI(ctx, selection.text, win)
    await sendToWindow(win, 'translate:result', {
      sourceText: selection.text,
      translatedText,
      completedAt: Date.now()
    })
    ctx.progress(1, '翻译完成')
    return { translated: true, sourceText: selection.text, translatedText }
  } catch (error) {
    const payload = {
      sourceText: selection.text,
      error: errorMessage(error),
      failedAt: Date.now()
    }
    await sendToWindow(win, 'translate:error', payload).catch(() => {})
    throw error
  }
})

plugin.onCommand('translate-screenshot-overlay', async (ctx) => {
  ctx.progress(0.05, '请框选要翻译的截图区域')
  const outputDir = path.join(os.tmpdir(), 'brickly-quick-translate')
  await fs.mkdir(outputDir, { recursive: true })
  const ocrInput = {
    languageType: SCREENSHOT_LANGUAGE,
    probability: false,
    outputDir,
    keepScreenshot: true
  }
  debugLog('screenshot-ocr.request', ocrInput)
  const ocr = await ctx.invoke('com.brickly.glm-ocr-screenshot', 'capture-text', ocrInput)

  const screenshotPath = typeof ocr?.screenshotPath === 'string' ? ocr.screenshotPath : ''
  const wordsResult = Array.isArray(ocr?.wordsResult) ? ocr.wordsResult : []
  const bounds = normalizeScreenBounds(ocr?.bounds)
  debugLog('screenshot-ocr.response', summarizeOcrResult(ocr, wordsResult, bounds))
  if (!screenshotPath) throw new Error('GLM OCR 未返回截图路径')
  if (!bounds) throw new Error('截图结果缺少屏幕坐标，无法贴回原位置')
  if (wordsResult.length === 0) {
    return { translated: false, reason: 'ocr-empty', screenshotPath, bounds }
  }

  ctx.progress(0.45, '翻译截图文字')
  const translations = await translateOcrBlocksWithOpenAI(ctx, wordsResult)

  ctx.progress(0.76, '生成覆盖翻译图片')
  const overlayPath = path.join(outputDir, `quick-translate-overlay-${Date.now()}.png`)
  const rendered = await renderScreenshotOverlay({
    screenshotPath,
    wordsResult,
    translations,
    outputPath: overlayPath
  })
  debugLog('screenshot-render.response', {
    outputPath: rendered.outputPath,
    width: rendered.width,
    height: rendered.height,
    blockCount: rendered.blocks.length,
    blocks: summarizeRenderBlocks(rendered.blocks)
  })

  ctx.progress(0.92, '贴回原屏幕位置')
  const overlayPayload = {
    imagePath: overlayPath,
    bounds,
    width: rendered.width,
    height: rendered.height,
    blockCount: rendered.blocks.length,
    createdAt: Date.now()
  }
  debugLog('screenshot-overlay.window.request', overlayPayload)
  const win = await openScreenshotOverlayWindow(ctx, overlayPayload)
  debugLog('screenshot-overlay.window.response', {
    windowId: win.id,
    bounds,
    overlayPath
  })

  ctx.progress(1, '截图翻译已覆盖显示，按 Esc 关闭')
  return {
    translated: true,
    windowId: win.id,
    screenshotPath,
    overlayPath,
    bounds,
    blockCount: rendered.blocks.length
  }
})

plugin.onShutdown(async () => {
  if (translateWindow && !translateWindow.closed) {
    await translateWindow.close().catch(() => {})
  }
  await closeScreenshotOverlayWindow()
  translateWindow = null
})

plugin.start()

async function safeReadClipboard(ctx) {
  try {
    return await ctx.platform.clipboard.readContent()
  } catch (error) {
    plugin.log.warn(`read clipboard failed: ${errorMessage(error)}`)
    return { capturedAt: Date.now() }
  }
}

function selectedTextFromSnapshots(before, after) {
  if (!after || after.kind !== 'text') return { text: '', reason: 'clipboard-not-text' }
  const text = typeof after.text === 'string' ? after.text.trim() : ''
  if (!text) return { text: '', reason: 'clipboard-empty-text' }
  if (before && before.hash && after.hash && before.hash === after.hash) {
    return { text: '', reason: 'clipboard-hash-unchanged' }
  }
  return { text: text.slice(0, MAX_SOURCE_CHARS), reason: 'selected-text' }
}

function logClipboardDecision(selection, before, after) {
  plugin.log.info(
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

function clipboardContentFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null
  if (snapshot.kind === 'text' && typeof snapshot.text === 'string') {
    return { kind: 'text', text: snapshot.text }
  }
  if (snapshot.kind === 'file' && Array.isArray(snapshot.paths) && snapshot.paths.length > 0) {
    const paths = snapshot.paths.filter((path) => typeof path === 'string')
    return paths.length > 0 ? { kind: 'file', paths } : null
  }
  if (snapshot.kind === 'image') {
    if (typeof snapshot.path === 'string' && snapshot.path) return { kind: 'image', path: snapshot.path }
    if (snapshot.resource && typeof snapshot.resource.filePath === 'string') {
      return { kind: 'image', path: snapshot.resource.filePath }
    }
  }
  return null
}

async function ensureTranslateWindow(ctx) {
  const bounds = await getPopupBounds(ctx)
  if (translateWindow && !translateWindow.closed) {
    await translateWindow.setBounds(bounds).catch(() => {})
    await translateWindow.setOpacity(0).catch(() => {})
    await translateWindow.showInactive().catch(() => translateWindow.show())
    await translateWindow.focus().catch(() => {})
    await animateWindowIn(translateWindow)
    return translateWindow
  }

  translateWindow = await plugin.ui.createBrowserWindow(WINDOW_HTML, {
    ...bounds,
    minWidth: 320,
    minHeight: WINDOW_MIN_HEIGHT,
    maxHeight: WINDOW_MAX_HEIGHT,
    title: 'Brickly · 快速翻译',
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
  translateWindow.on('closed', () => {
    translateWindow = null
    translateWindowBounds = null
  })
  translateWindow.on('message', (payload) => {
    if (!payload) return
    if (payload.channel === 'quick-translate:close') {
      void closeTranslateWindow()
    } else if (payload.channel === 'quick-translate:resize') {
      void resizeTranslateWindow(ctx, payload.args?.[0])
    }
  })
  await translateWindow.showInactive().catch(() => translateWindow.show())
  await translateWindow.focus().catch(() => {})
  await animateWindowIn(translateWindow)
  return translateWindow
}

async function closeTranslateWindow() {
  if (!translateWindow || translateWindow.closed) return
  const win = translateWindow
  translateWindow = null
  await win.close().catch(() => {})
}

async function resizeTranslateWindow(ctx, payload) {
  if (!translateWindow || translateWindow.closed) return
  const requestedHeight = Number(payload?.height)
  if (!Number.isFinite(requestedHeight)) return
  const current = translateWindowBounds || (await getPopupBounds(ctx))
  const next = await clampPopupBounds(ctx, {
    ...current,
    height: clamp(requestedHeight, WINDOW_MIN_HEIGHT, WINDOW_MAX_HEIGHT)
  })
  if (next.height === current.height && next.y === current.y) return
  translateWindowBounds = next
  await translateWindow.setBounds(next).catch(() => {})
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
  translateWindowBounds = bounds
  return bounds
}

async function clampPopupBounds(ctx, bounds) {
  const cursor = await ctx.platform.screen
    .getCursorScreenPoint()
    .catch(() => ({ x: bounds.x, y: bounds.y }))
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
  await win.call('webContents.send', [channel, payload])
}

async function translateWithOpenAI(ctx, sourceText, win) {
  const input = {
    model: undefined,
    messages: [
      {
        role: 'system',
        content: '你是专业翻译。将用户提供的英文翻译成自然、准确、简洁的简体中文。只输出译文，不要解释。'
      },
      {
        role: 'user',
        content: `将以下英文翻译成自然、准确的简体中文，只输出译文：\n\n${sourceText}`
      }
    ],
    stream: true,
    temperature: 0.2
  }
  let streamedText = ''
  let finalResult = null
  for await (const event of ctx.invokeStream('com.brickly.openai', 'chat-completions', input)) {
    if (event.type === 'chunk' && event.name === 'text' && typeof event.chunk === 'string') {
      streamedText += event.chunk
      await sendToWindow(win, 'translate:delta', {
        delta: event.chunk,
        translatedText: streamedText,
        updatedAt: Date.now()
      }).catch(() => {})
    } else if (event.type === 'result') {
      finalResult = event.result
    } else if (event.type === 'error') {
      throw event.error
    }
  }
  const result = finalResult || { text: streamedText }
  const text = extractText(result)
  const translatedText = text || streamedText
  if (!translatedText) throw new Error('OpenAI 未返回可用译文')
  return translatedText.trim()
}

async function translateOcrBlocksWithOpenAI(ctx, wordsResult) {
  const items = wordsResult
    .map((item, index) => ({
      index,
      text: typeof item?.words === 'string' ? item.words.trim() : ''
    }))
    .filter((item) => item.text)

  if (items.length === 0) return []

  const input = {
    model: undefined,
    messages: [
      {
        role: 'system',
        content:
          '你是专业截图翻译引擎。把 OCR 识别出的外文短句翻译成自然、简洁的简体中文。保留数组顺序，只输出 JSON。'
      },
      {
        role: 'user',
        content:
          '请把下面 JSON 数组中每个 text 翻译成简体中文，返回同长度 JSON 数组，每项格式为 {"index": number, "translatedText": string}，不要输出解释或 Markdown：\n\n' +
          JSON.stringify(items)
      }
    ],
    stream: false,
    temperature: 0.2
  }

  debugLog('screenshot-translate.request', {
    brickId: 'com.brickly.openai',
    commandId: 'chat-completions',
    stream: input.stream,
    temperature: input.temperature,
    items,
    prompt: truncate(input.messages.map((message) => message.content).join('\n\n'), 1200)
  })
  const result = await ctx.invoke('com.brickly.openai', 'chat-completions', input)
  const text = extractText(result).trim()
  debugLog('screenshot-translate.response.raw', {
    text: truncate(text, 2000),
    result: summarizeValue(result, 2000)
  })
  const parsed = parseJsonFromText(text)
  const translations = []
  const parsedItems = normalizeTranslationItems(parsed, text)
  if (Array.isArray(parsedItems)) {
    for (const item of parsedItems) {
      const index = Number(item?.index)
      const translatedText = typeof item?.translatedText === 'string' ? item.translatedText : ''
      if (Number.isInteger(index) && translatedText) translations[index] = translatedText
    }
  }
  const finalTranslations = items.map((item) => translations[item.index] || item.text)
  debugLog('screenshot-translate.response.parsed', {
    parsedOk: Array.isArray(parsedItems),
    translations: finalTranslations.map((text, index) => ({
      index: items[index]?.index ?? index,
      text: truncate(text, 240)
    }))
  })
  return finalTranslations
}

function parseJsonFromText(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function normalizeTranslationItems(parsed, rawText) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.translations)) return parsed.translations
    if (Number.isInteger(Number(parsed.index))) return [parsed]
  }

  const items = parseAdjacentJsonObjects(rawText)
  return items.length > 0 ? items : null
}

function parseAdjacentJsonObjects(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) return []
  const items = []
  const objectPattern = /\{[^{}]*"index"\s*:\s*\d+[^{}]*"translatedText"\s*:\s*"[^"]*"[^{}]*\}/g
  for (const match of value.matchAll(objectPattern)) {
    try {
      items.push(JSON.parse(match[0]))
    } catch {
      // 忽略单个坏块，后面仍可使用其它翻译块。
    }
  }
  return items
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

function normalizeScreenBounds(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const width = Number(value.width)
  const height = Number(value.height)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

function debugLog(label, payload) {
  const message = `[quick-translate][${label}] ${safeJsonStringify(payload)}`
  plugin.log.info(escapeNonAscii(message))
  void appendDebugLog(message)
}

function summarizeOcrResult(ocr, wordsResult, bounds) {
  return {
    screenshotPath: typeof ocr?.screenshotPath === 'string' ? ocr.screenshotPath : '',
    bounds,
    wordsText: truncate(typeof ocr?.wordsText === 'string' ? ocr.wordsText : '', 800),
    wordsCount: wordsResult.length,
    words: wordsResult.slice(0, 20).map((item, index) => ({
      index,
      text: truncate(typeof item?.words === 'string' ? item.words : '', 240),
      location: item?.location || null
    })),
    ocrResponseKeys: ocr && typeof ocr === 'object' ? Object.keys(ocr).slice(0, 20) : []
  }
}

function summarizeRenderBlocks(blocks) {
  return blocks.slice(0, 20).map((block) => ({
    index: block.index,
    sourceText: truncate(block.sourceText, 160),
    translatedText: truncate(block.translatedText, 160),
    box: block.box,
    backgroundColor: block.backgroundColor
  }))
}

function summarizeValue(value, maxLength) {
  return truncate(safeJsonStringify(value), maxLength)
}

function safeJsonStringify(value) {
  const seen = new WeakSet()
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString()
      if (!item || typeof item !== 'object') return item
      if (seen.has(item)) return '[Circular]'
      seen.add(item)
      return item
    })
  } catch (error) {
    return JSON.stringify({ stringifyError: errorMessage(error) })
  }
}

async function appendDebugLog(message) {
  try {
    await fs.mkdir(path.dirname(DEBUG_LOG_FILE), { recursive: true })
    await fs.appendFile(DEBUG_LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch (error) {
    plugin.log.warn(`[quick-translate][debug-log.write-error] ${escapeNonAscii(errorMessage(error))}`)
  }
}

function escapeNonAscii(value) {
  return String(value).replace(/[^\x20-\x7e]/g, (char) => {
    const code = char.codePointAt(0)
    if (code === undefined) return ''
    if (code <= 0xffff) return `\\u${code.toString(16).padStart(4, '0')}`
    const normalized = code - 0x10000
    const high = 0xd800 + (normalized >> 10)
    const low = 0xdc00 + (normalized & 0x3ff)
    return `\\u${high.toString(16)}\\u${low.toString(16)}`
  })
}

function truncate(value, maxLength) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...<truncated ${text.length - maxLength} chars>`
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
