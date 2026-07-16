'use strict'

const fs = require('node:fs/promises')
const { readFileBuffer } = require('../lib/pipeline')

/**
 * Parse color for sharp create() with 4 channels.
 * @param {string} bg
 */
function parseBackground (bg) {
  if (!bg || bg === 'transparent') {
    return { r: 0, g: 0, b: 0, alpha: 0 }
  }
  const s = String(bg).trim()
  if (s.startsWith('#') && (s.length === 7 || s.length === 9)) {
    const r = parseInt(s.slice(1, 3), 16)
    const g = parseInt(s.slice(3, 5), 16)
    const b = parseInt(s.slice(5, 7), 16)
    const alpha = s.length === 9 ? parseInt(s.slice(7, 9), 16) / 255 : 1
    return { r, g, b, alpha }
  }
  return s
}

module.exports = {
  id: 'join',
  mode: 'multi',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { files, options = {} } = ctx
    if (!files || !files.length) throw new Error('join requires ctx.files')

    const direction = options.direction || 'vertical'
    const gap = typeof options.gap === 'number' ? options.gap : 0
    const bg = parseBackground(options.bg || '#00000000')

    const imgMetas = []
    for (const f of files) {
      await fs.access(f)
      const buf = await readFileBuffer(f)
      // Normalize to PNG buffer so composite is reliable
      const pngBuf = await sharp(buf).ensureAlpha().png().toBuffer()
      const m = await sharp(pngBuf).metadata()
      imgMetas.push({
        buffer: pngBuf,
        width: m.width || 0,
        height: m.height || 0
      })
    }

    let finalW = 0
    let finalH = 0

    if (direction === 'vertical') {
      finalW = Math.max(...imgMetas.map((m) => m.width))
      finalH =
        imgMetas.reduce((sum, m) => sum + m.height, 0) +
        Math.max(0, files.length - 1) * gap
    } else {
      finalW =
        imgMetas.reduce((sum, m) => sum + m.width, 0) +
        Math.max(0, files.length - 1) * gap
      finalH = Math.max(...imgMetas.map((m) => m.height))
    }

    if (finalW < 1 || finalH < 1) {
      throw Object.assign(new Error('拼接画布尺寸无效'), { code: 'JOIN_INVALID_SIZE' })
    }
    // Guard extreme memory
    if (finalW * finalH > 80_000_000) {
      throw Object.assign(
        new Error('拼接结果过大，请先缩小图片或减少张数'),
        { code: 'JOIN_TOO_LARGE' }
      )
    }

    const compositeLayers = []
    let offset = 0

    for (let i = 0; i < imgMetas.length; i++) {
      const item = imgMetas[i]
      let left = 0
      let top = 0

      if (direction === 'vertical') {
        left = Math.round((finalW - item.width) / 2)
        top = offset
        offset += item.height + gap
      } else {
        left = offset
        top = Math.round((finalH - item.height) / 2)
        offset += item.width + gap
      }

      compositeLayers.push({
        input: item.buffer,
        left,
        top
      })
    }

    // Explicit PNG so preview/save never looks like raw strip
    const buffer = await sharp({
      create: {
        width: finalW,
        height: finalH,
        channels: 4,
        background: bg
      }
    })
      .composite(compositeLayers)
      .png()
      .toBuffer()

    return {
      type: 'buffer',
      buffer,
      format: 'png'
    }
  }
}
