'use strict'

/**
 * Rotate image by angle degrees.
 */
module.exports = {
  id: 'rotate',
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
    const angle = typeof options.angle === 'number' ? options.angle : 90
    const bg = options.bg || '#00000000'

    return {
      type: 'pipeline',
      pipeline: sharp(inputPath).rotate(angle, { background: bg })
    }
  }
}
