/* eslint-disable */
'use strict'

const fs = require('fs/promises')
const path = require('path')
const { makeError } = require('./errors')

async function buildOcrRenderPayload({
  screenshotPath,
  wordsResult,
  wordsText,
  ocrResponse,
  languageType,
  probability
}) {
  const imageBuffer = await fs.readFile(screenshotPath)
  const imageSize = readPngSizeFromBuffer(imageBuffer)
  const normalizedWordsResult = normalizeWordsResult(wordsResult)
  const text = typeof wordsText === 'string' ? wordsText : extractWordsText(normalizedWordsResult)

  return {
    generatedAt: new Date().toISOString(),
    screenshot: {
      path: screenshotPath,
      name: path.basename(screenshotPath),
      mimeType: 'image/png',
      width: imageSize.width,
      height: imageSize.height,
      dataUrl: `data:image/png;base64,${imageBuffer.toString('base64')}`
    },
    ocr: {
      status: stringOrEmpty(ocrResponse && ocrResponse.status),
      message: stringOrEmpty(ocrResponse && ocrResponse.message),
      taskId: stringOrEmpty(ocrResponse && ocrResponse.task_id),
      wordsResultNum:
        Number.isFinite(Number(ocrResponse && ocrResponse.words_result_num))
          ? Number(ocrResponse.words_result_num)
          : normalizedWordsResult.length,
      wordsText: text,
      wordsResult: normalizedWordsResult
    },
    options: {
      languageType,
      probability: probability === true
    }
  }
}

function normalizeWordsResult(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function extractWordsText(wordsResult) {
  return normalizeWordsResult(wordsResult)
    .map((item) => (typeof item.words === 'string' ? item.words : ''))
    .filter(Boolean)
    .join('\n')
}

function readPngSizeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw makeError('INVALID_SCREENSHOT', '截图文件不是有效 PNG')
  }
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    throw makeError('INVALID_SCREENSHOT', '截图文件不是有效 PNG')
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw makeError('INVALID_SCREENSHOT', '截图 PNG 尺寸无效')
  }
  return { width, height }
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : ''
}

module.exports = {
  buildOcrRenderPayload,
  normalizeWordsResult,
  extractWordsText,
  readPngSizeFromBuffer
}
