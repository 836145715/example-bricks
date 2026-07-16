'use strict'

/**
 * Extend canvas with padding (border / letterbox).
 */
module.exports = {
  id: 'padding',
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
    const top = typeof options.top === 'number' ? options.top : 20
    const bottom = typeof options.bottom === 'number' ? options.bottom : 20
    const left = typeof options.left === 'number' ? options.left : 20
    const right = typeof options.right === 'number' ? options.right : 20
    const bg = options.bg || '#ffffff'

    return {
      type: 'pipeline',
      pipeline: sharp(inputPath).extend({
        top,
        bottom,
        left,
        right,
        background: bg
      })
    }
  }
}
