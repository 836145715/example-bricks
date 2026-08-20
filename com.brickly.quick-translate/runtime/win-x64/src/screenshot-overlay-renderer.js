/* eslint-disable */
'use strict'

const fs = require('fs/promises')
const path = require('path')
const sharp = require('sharp')

const DEFAULT_FONT_FAMILY = 'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Arial, sans-serif'

async function renderScreenshotOverlay({ screenshotPath, wordsResult, translations, outputPath }) {
  const image = sharp(screenshotPath)
  const metadata = await image.metadata()
  const imageWidth = Number(metadata.width) || 0
  const imageHeight = Number(metadata.height) || 0
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('截图尺寸无效，无法渲染覆盖翻译')
  }

  const blocks = normalizeBlocks(wordsResult, translations, imageWidth, imageHeight)
  if (blocks.length === 0) {
    throw new Error('没有可渲染的 OCR 文本块')
  }

  const coverLayers = []
  const textLayers = []
  for (const block of blocks) {
    coverLayers.push(await buildCoverLayer(screenshotPath, block, imageWidth, imageHeight))
    textLayers.push(buildTextLayer(block))
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await sharp(screenshotPath)
    .composite([...coverLayers, ...textLayers])
    .png()
    .toFile(outputPath)

  return {
    outputPath,
    width: imageWidth,
    height: imageHeight,
    blocks
  }
}

function normalizeBlocks(wordsResult, translations, imageWidth, imageHeight) {
  const list = Array.isArray(wordsResult) ? wordsResult : []
  return list
    .map((item, index) => {
      const box = normalizeBox(item && item.location, imageWidth, imageHeight)
      const sourceText = typeof item?.words === 'string' ? item.words.trim() : ''
      const translatedText = pickTranslation(translations, index).trim()
      if (!box || !sourceText || !translatedText) return null
      return { index, sourceText, translatedText, box }
    })
    .filter(Boolean)
}

function normalizeBox(location, imageWidth, imageHeight) {
  if (!location || typeof location !== 'object') return null
  const left = Number(location.left)
  const top = Number(location.top)
  const width = Number(location.width)
  const height = Number(location.height)
  if (![left, top, width, height].every(Number.isFinite)) return null
  if (width <= 1 || height <= 1) return null

  const paddingX = Math.max(2, Math.round(width * 0.06))
  const paddingY = Math.max(2, Math.round(height * 0.16))
  const x = clamp(left - paddingX, 0, imageWidth - 1)
  const y = clamp(top - paddingY, 0, imageHeight - 1)
  const right = clamp(left + width + paddingX, x + 1, imageWidth)
  const bottom = clamp(top + height + paddingY, y + 1, imageHeight)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(right - x)),
    height: Math.max(1, Math.round(bottom - y))
  }
}

function pickTranslation(translations, index) {
  if (Array.isArray(translations)) {
    const item = translations[index]
    if (typeof item === 'string') return item
    if (item && typeof item.text === 'string') return item.text
    if (item && typeof item.translatedText === 'string') return item.translatedText
  }
  if (translations && typeof translations === 'object') {
    const item = translations[index] || translations[String(index)]
    if (typeof item === 'string') return item
    if (item && typeof item.text === 'string') return item.text
    if (item && typeof item.translatedText === 'string') return item.translatedText
  }
  return ''
}

async function buildCoverLayer(screenshotPath, block, imageWidth, imageHeight) {
  const color = await sampleLocalBackgroundColor(screenshotPath, block.box, imageWidth, imageHeight)
  block.backgroundColor = color
  return {
    input: solidRectSvg(block.box.width, block.box.height, color, 1),
    left: block.box.x,
    top: block.box.y
  }
}

async function sampleLocalBackgroundColor(screenshotPath, box, imageWidth, imageHeight) {
  const margin = Math.max(4, Math.round(Math.min(box.width, box.height) * 0.55))
  const sample = {
    left: Math.round(clamp(box.x - margin, 0, imageWidth - 1)),
    top: Math.round(clamp(box.y - margin, 0, imageHeight - 1)),
    width: 1,
    height: 1
  }
  const right = Math.round(clamp(box.x + box.width + margin, sample.left + 1, imageWidth))
  const bottom = Math.round(clamp(box.y + box.height + margin, sample.top + 1, imageHeight))
  sample.width = right - sample.left
  sample.height = bottom - sample.top

  const { data, info } = await sharp(screenshotPath)
    .extract(sample)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const red = []
  const green = []
  const blue = []
  const channels = info.channels || 3
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const globalX = sample.left + x
      const globalY = sample.top + y
      if (pointInsideRect(globalX, globalY, box)) continue
      const offset = (y * info.width + x) * channels
      red.push(data[offset])
      green.push(data[offset + 1])
      blue.push(data[offset + 2])
    }
  }

  if (red.length < 12) {
    for (let offset = 0; offset < data.length; offset += channels) {
      red.push(data[offset])
      green.push(data[offset + 1])
      blue.push(data[offset + 2])
    }
  }

  return rgbToHex(median(red), median(green), median(blue))
}

function pointInsideRect(x, y, rect) {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

function buildTextLayer(block) {
  return {
    input: Buffer.from(textBlockSvg(block), 'utf8'),
    left: block.box.x,
    top: block.box.y
  }
}

function textBlockSvg(block) {
  const box = block.box
  const paddingX = Math.max(3, Math.round(box.width * 0.05))
  const paddingY = Math.max(2, Math.round(box.height * 0.12))
  const maxTextWidth = Math.max(8, box.width - paddingX * 2)
  const maxTextHeight = Math.max(8, box.height - paddingY * 2)
  const fontSize = fitFontSize(block.translatedText, maxTextWidth, maxTextHeight)
  const lines = wrapText(block.translatedText, maxTextWidth, fontSize).slice(0, 4)
  const lineHeight = Math.round(fontSize * 1.22)
  const textHeight = lines.length * lineHeight
  const startY = Math.max(paddingY + fontSize, Math.round((box.height - textHeight) / 2) + fontSize - 1)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">`,
    `<text x="${paddingX}" y="${startY}" font-family="${escapeXml(DEFAULT_FONT_FAMILY)}" font-size="${fontSize}" font-weight="650" fill="${textColorForBackground(block.backgroundColor)}">`,
    ...lines.map((line, index) => `<tspan x="${paddingX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`),
    '</text>',
    '</svg>'
  ].join('')
}

function fitFontSize(text, maxWidth, maxHeight) {
  const cleanText = String(text || '')
  const upper = Math.max(10, Math.min(30, Math.floor(maxHeight * 0.72)))
  for (let size = upper; size >= 9; size -= 1) {
    const lines = wrapText(cleanText, maxWidth, size)
    if (lines.length * size * 1.22 <= maxHeight) return size
  }
  return 9
}

function wrapText(text, maxWidth, fontSize) {
  const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim())
  const lines = []
  let line = ''
  for (const char of chars) {
    const next = line + char
    if (line && estimateTextWidth(next, fontSize) > maxWidth) {
      lines.push(line)
      line = char
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function estimateTextWidth(text, fontSize) {
  let width = 0
  for (const char of Array.from(text)) {
    width += /[\u4e00-\u9fff]/.test(char) ? fontSize : fontSize * 0.56
  }
  return width
}

function solidRectSvg(width, height, color, opacity) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}" fill-opacity="${opacity}"/></svg>`,
    'utf8'
  )
}

function median(values) {
  if (!values.length) return 248
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function rgbToHex(red, green, blue) {
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function toHex(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

function textColorForBackground(color) {
  const rgb = hexToRgb(color)
  if (!rgb) return '#111827'
  const luminance = (0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue) / 255
  return luminance < 0.42 ? '#ffffff' : '#111827'
}

function hexToRgb(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(color || ''))
  if (!match) return null
  const value = match[1]
  return {
    red: parseInt(value.slice(0, 2), 16),
    green: parseInt(value.slice(2, 4), 16),
    blue: parseInt(value.slice(4, 6), 16)
  }
}

function clamp(value, min, max) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

module.exports = {
  renderScreenshotOverlay,
  normalizeBlocks,
  normalizeBox,
  wrapText
}
