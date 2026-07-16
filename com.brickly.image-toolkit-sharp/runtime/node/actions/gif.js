'use strict'

const fs = require('node:fs/promises')

/**
 * Build an animated GIF from multiple frames (stacked tall sheet + pageHeight).
 */
module.exports = {
  id: 'gif',
  mode: 'multi',

  /**
   * @param {object} ctx
   * @param {string} ctx.inputPath - first frame (size reference)
   * @param {string[]} ctx.files
   * @param {object} ctx.options
   * @param {function} ctx.loadSharp
   * @param {function} [ctx.ensureNotCancelled]
   * @returns {Promise<{ type: 'pipeline', pipeline: import('sharp').Sharp }>}
   */
  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, files, options = {} } = ctx
    if (!files || !files.length) throw new Error('gif requires ctx.files')

    const delay = typeof options.delay === 'number' ? options.delay : 200
    const primary = inputPath || files[0]

    const firstMeta = await sharp(primary).metadata()
    const w = firstMeta.width || 500
    const h = firstMeta.height || 500

    const frameBuffers = []
    for (let i = 0; i < files.length; i++) {
      if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
      const f = files[i]
      await fs.access(f)
      const buf = await sharp(f).resize({ width: w, height: h, fit: 'fill' }).png().toBuffer()
      frameBuffers.push(buf)
    }

    const tallBuffer = await sharp({
      create: {
        width: w,
        height: h * files.length,
        channels: 4,
        background: '#00000000'
      }
    })
      .composite(frameBuffers.map((buf, i) => ({
        input: buf,
        left: 0,
        top: i * h
      })))
      .png()
      .toBuffer()

    return {
      type: 'pipeline',
      pipeline: sharp(tallBuffer, {
        animated: true,
        pageHeight: h
      }).gif({
        delay,
        loop: 0
      })
    }
  }
}
