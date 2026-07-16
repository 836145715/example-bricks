'use strict'

/**
 * Compress image by quality, optionally binary-search to target size.
 */
module.exports = {
  id: 'compress',
  mode: 'per-file',

  /**
   * @param {object} ctx
   * @param {string} ctx.inputPath
   * @param {object} ctx.options
   * @param {function} ctx.loadSharp
   * @param {function} [ctx.ensureNotCancelled]
   * @returns {Promise<{ type: 'pipeline', pipeline: import('sharp').Sharp } | { type: 'buffer', buffer: Buffer }>}
   */
  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const quality = typeof options.quality === 'number' ? options.quality : 80
    const targetSizeKb = typeof options.targetSizeKb === 'number' ? options.targetSizeKb : null

    const meta = await sharp(inputPath).metadata()
    const format = meta.format || 'jpeg'

    if (targetSizeKb && ['jpeg', 'webp', 'avif'].includes(format)) {
      let minQ = 5
      let maxQ = 100
      let bestBuffer = null
      const targetBytes = targetSizeKb * 1024

      for (let iter = 0; iter < 7; iter++) {
        if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
        const currentQ = Math.round((minQ + maxQ) / 2)
        let pipeline = sharp(inputPath)
        if (format === 'jpeg') pipeline.jpeg({ quality: currentQ })
        else if (format === 'webp') pipeline.webp({ quality: currentQ })
        else if (format === 'avif') pipeline.avif({ quality: currentQ })

        const buf = await pipeline.toBuffer()
        if (buf.length <= targetBytes) {
          bestBuffer = buf
          minQ = currentQ + 1
        } else {
          maxQ = currentQ - 1
        }
      }

      if (bestBuffer) {
        return { type: 'buffer', buffer: bestBuffer }
      }
      return {
        type: 'pipeline',
        pipeline: sharp(inputPath).jpeg({ quality: 5 })
      }
    }

    let pipeline = sharp(inputPath)
    if (format === 'jpeg' || format === 'jpg') {
      pipeline.jpeg({ quality })
    } else if (format === 'webp') {
      pipeline.webp({ quality })
    } else if (format === 'png') {
      pipeline.png({ compressionLevel: 9 })
    } else if (format === 'avif') {
      pipeline.avif({ quality })
    } else {
      pipeline.toFormat(format, { quality })
    }
    return { type: 'pipeline', pipeline }
  }
}
