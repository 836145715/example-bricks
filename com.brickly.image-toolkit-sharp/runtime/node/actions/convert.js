'use strict'

/**
 * Convert image to another format.
 */
module.exports = {
  id: 'convert',
  mode: 'per-file',

  /**
   * @param {object} ctx
   * @param {string} ctx.inputPath
   * @param {object} ctx.options
   * @param {function} ctx.loadSharp
   * @returns {Promise<{ type: 'pipeline', pipeline: import('sharp').Sharp }>}
   */
  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const format = options.format || 'webp'
    const quality = typeof options.quality === 'number' ? options.quality : 82
    const lossless = !!options.lossless

    let pipeline = sharp(inputPath)
    if (format === 'jpeg' || format === 'jpg') {
      pipeline.jpeg({ quality })
    } else if (format === 'webp') {
      pipeline.webp({ quality, lossless })
    } else if (format === 'png') {
      pipeline.png({ compressionLevel: 9 })
    } else if (format === 'avif') {
      pipeline.avif({ quality, lossless })
    } else if (format === 'gif') {
      pipeline.gif()
    } else {
      pipeline.toFormat(format, { quality })
    }

    return { type: 'pipeline', pipeline }
  }
}
