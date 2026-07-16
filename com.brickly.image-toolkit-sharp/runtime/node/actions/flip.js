'use strict'

/**
 * Mirror flip: vertical (flip) and/or horizontal (flop).
 */
module.exports = {
  id: 'flip',
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
    const horizontal = !!options.horizontal
    const vertical = !!options.vertical

    let pipeline = sharp(inputPath)
    if (vertical) pipeline = pipeline.flip()
    if (horizontal) pipeline = pipeline.flop()

    return { type: 'pipeline', pipeline }
  }
}
