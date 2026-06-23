/* eslint-disable */
'use strict'

const fs = require('fs/promises')
const path = require('path')
const { normalizeCaptureInput } = require('./input')
const { buildOcrRenderPayload } = require('./render-payload')
const { openResultWindow } = require('./result-window')
const { makeError } = require('./errors')

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function ensureActive(ctx) {
  if (ctx.isCancelled()) throw makeError('CANCELLED', 'Cancelled by host')
}

async function captureAnnotate(ctx, rawInput) {
  const input = normalizeCaptureInput(rawInput || {})

  await fs.mkdir(input.outputDir, { recursive: true })
  const baseName = `glm-ocr-${timestamp()}`
  const screenshotPath = path.join(input.outputDir, `${baseName}.png`)
  let actualScreenshotPath = screenshotPath
  let screenshotCreated = false

  try {
    ctx.progress(0.05, '请框选截图区域')
    const screenshot = await ctx.platform.screenshot.selectRegion({ outputPath: screenshotPath })
    actualScreenshotPath = screenshot.path
    screenshotCreated = true
    const bounds = screenshot.bounds
    ensureActive(ctx)
    ctx.output('screenshotPath', input.keepScreenshot ? actualScreenshotPath : '')

    ctx.progress(0.35, '调用 GLM OCR')
    const ocrResponse = await ctx.invoke('com.brickly.glm-tools', 'ocr', {
      imagePath: actualScreenshotPath,
      languageType: input.languageType,
      probability: input.probability
    })
    ensureActive(ctx)

    const wordsResult = Array.isArray(ocrResponse && ocrResponse.words_result)
      ? ocrResponse.words_result
      : []
    const wordsText = wordsResult.map((item) => item.words || '').filter(Boolean).join('\n')

    ctx.progress(0.72, '打开 OCR 标注窗口')
    const renderPayload = await buildOcrRenderPayload({
      screenshotPath: actualScreenshotPath,
      wordsResult,
      wordsText,
      ocrResponse,
      languageType: input.languageType,
      probability: input.probability
    })
    const resultWindow = await openResultWindow(ctx, renderPayload)
    ensureActive(ctx)

    ctx.output('windowId', resultWindow.id)
    ctx.output('screenshotPath', input.keepScreenshot ? actualScreenshotPath : '')
    ctx.output('bounds', bounds)
    ctx.output('wordsText', wordsText)
    ctx.output('wordsResult', wordsResult)
    ctx.output('ocrResponse', ocrResponse)
    ctx.progress(1, 'OCR 标注窗口已打开')

    return {
      windowId: resultWindow.id,
      screenshotPath: input.keepScreenshot ? actualScreenshotPath : '',
      bounds,
      wordsText,
      wordsResult,
      ocrResponse
    }
  } finally {
    // H5 弹窗使用 dataURL 渲染截图；用户未要求保留文件时，上传和开窗后即可清理本地截图。
    if (screenshotCreated && !input.keepScreenshot) {
      await fs.rm(actualScreenshotPath, { force: true })
    }
  }
}

async function captureText(ctx, rawInput) {
  const input = normalizeCaptureInput(rawInput || {})

  await fs.mkdir(input.outputDir, { recursive: true })
  const screenshotPath = path.join(input.outputDir, `glm-ocr-text-${timestamp()}.png`)
  let actualScreenshotPath = screenshotPath
  let screenshotCreated = false

  try {
    ctx.progress(0.08, '请框选截图区域')
    const screenshot = await ctx.platform.screenshot.selectRegion({ outputPath: screenshotPath })
    actualScreenshotPath = screenshot.path
    screenshotCreated = true
    const bounds = screenshot.bounds
    ensureActive(ctx)

    ctx.progress(0.42, '调用 GLM OCR')
    const ocrResponse = await ctx.invoke('com.brickly.glm-tools', 'ocr', {
      imagePath: actualScreenshotPath,
      languageType: input.languageType,
      probability: input.probability
    })
    ensureActive(ctx)

    const wordsResult = Array.isArray(ocrResponse && ocrResponse.words_result)
      ? ocrResponse.words_result
      : []
    const wordsText = wordsResult.map((item) => item.words || '').filter(Boolean).join('\n')

    ctx.output('screenshotPath', input.keepScreenshot ? actualScreenshotPath : '')
    ctx.output('bounds', bounds)
    ctx.output('wordsText', wordsText)
    ctx.output('wordsResult', wordsResult)
    ctx.output('ocrResponse', ocrResponse)
    ctx.progress(1, 'OCR 识别完成')

    return {
      screenshotPath: input.keepScreenshot ? actualScreenshotPath : '',
      bounds,
      wordsText,
      wordsResult,
      ocrResponse
    }
  } finally {
    if (screenshotCreated && !input.keepScreenshot) {
      await fs.rm(actualScreenshotPath, { force: true })
    }
  }
}

module.exports = {
  captureAnnotate,
  captureText
}
