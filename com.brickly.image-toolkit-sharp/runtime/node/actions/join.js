'use strict'

const fs = require('node:fs/promises')

/**
 * Join multiple images vertically or horizontally into one canvas.
 */
module.exports = {
  id: 'join',
  mode: 'multi',

  /**
   * @param {object} ctx
   * @param {string[]} ctx.files
   * @param {object} ctx.options
   * @param {function} ctx.loadSharp
   * @returns {Promise<{ type: 'pipeline', pipeline: import('sharp').Sharp }>}
   */
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
      const m = await sharp(f).metadata()
      imgMetas.push({ file: f, width: m.width || 0, height: m.height || 0 })
    }

    let finalW = 0
    let finalH = 0

    if (direction === 'vertical') {
      finalW = Math.max(...imgMetas.map(m => m.width))
      finalH = imgMetas.reduce((sum, m) => sum + m.height, 0) + (files.length - 1) * gap
    } else {
      finalW = imgMetas.reduce((sum, m) => sum + m.width, 0) + (files.length - 1) * gap
      finalH = Math.max(...imgMetas.map(m => m.height))
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
        input: item.file,
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
