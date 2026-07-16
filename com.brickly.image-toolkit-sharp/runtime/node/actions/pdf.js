'use strict'

const fs = require('node:fs/promises')

/**
 * Convert multiple images to a multi-page PDF (JPEG pages + compileJpegsToPdf).
 * Writes the file itself → returns { type: 'written' }.
 */
module.exports = {
  id: 'pdf',
  mode: 'multi',

  /**
   * @param {object} ctx
   * @param {string[]} ctx.files
   * @param {string} ctx.outputPath
   * @param {function} ctx.loadSharp
   * @param {function} ctx.compileJpegsToPdf
   * @param {function} [ctx.ensureNotCancelled]
   * @returns {Promise<{ type: 'written', outputPath: string }>}
   */
  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { files, outputPath } = ctx
    if (!files || !files.length) throw new Error('pdf requires ctx.files')
    if (!outputPath) throw new Error('pdf requires ctx.outputPath')
    if (typeof ctx.compileJpegsToPdf !== 'function') {
      throw new Error('pdf requires ctx.compileJpegsToPdf')
    }

    const jpegBuffers = []
    for (let i = 0; i < files.length; i++) {
      if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
      const file = files[i]
      await fs.access(file)
      const buf = await sharp(file).jpeg({ quality: 90 }).toBuffer()
      jpegBuffers.push(buf)
    }

    await ctx.compileJpegsToPdf(jpegBuffers, outputPath)
    return { type: 'written', outputPath }
  }
}
