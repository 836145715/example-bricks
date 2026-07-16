'use strict'

/**
 * Extract a rectangular region; out-of-bounds values are clamped.
 */
module.exports = {
  id: 'crop',
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
    const x = typeof options.x === 'number' ? options.x : 0
    const y = typeof options.y === 'number' ? options.y : 0
    const w = typeof options.width === 'number' ? options.width : 200
    const h = typeof options.height === 'number' ? options.height : 200

    const meta = await sharp(inputPath).metadata()
    // 防御性越界裁剪校验
    const extractLeft = Math.max(0, Math.min(x, (meta.width || w) - 1))
    const extractTop = Math.max(0, Math.min(y, (meta.height || h) - 1))
    const extractWidth = Math.max(1, Math.min(w, (meta.width || w) - extractLeft))
    const extractHeight = Math.max(1, Math.min(h, (meta.height || h) - extractTop))

    return {
      type: 'pipeline',
      pipeline: sharp(inputPath).extract({
        left: extractLeft,
        top: extractTop,
        width: extractWidth,
        height: extractHeight
      })
    }
  }
}
