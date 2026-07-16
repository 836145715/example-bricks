'use strict'

const fs = require('node:fs/promises')
const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'join',
  mode: 'multi',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { files, options = {} } = ctx
    if (!files || !files.length) throw new Error('join requires ctx.files')

    const direction = options.direction || 'vertical'
    const gap = typeof options.gap === 'number' ? options.gap : 0
    const bg = options.bg || '#00000000'

    const imgMetas = []
    for (const f of files) {
      await fs.access(f)
      const buf = await readFileBuffer(f)
      const m = await sharp(buf).metadata()
      imgMetas.push({ buffer: buf, width: m.width || 0, height: m.height || 0 })
    }

    let finalW = 0
    let finalH = 0

    if (direction === 'vertical') {
      finalW = Math.max(...imgMetas.map((m) => m.width))
      finalH = imgMetas.reduce((sum, m) => sum + m.height, 0) + (files.length - 1) * gap
    } else {
      finalW = imgMetas.reduce((sum, m) => sum + m.width, 0) + (files.length - 1) * gap
      finalH = Math.max(...imgMetas.map((m) => m.height))
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

      // Buffer input — never path (Windows lock)
      compositeLayers.push({
        input: item.buffer,
        left,
        top
      })
    }

    return {
      type: 'pipeline',
      pipeline: sharp({
        create: {
          width: finalW,
          height: finalH,
          channels: 4,
          background: bg
        }
      }).composite(compositeLayers)
    }
  }
}
