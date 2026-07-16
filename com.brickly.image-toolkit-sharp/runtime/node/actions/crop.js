'use strict'

const { clampExtract } = require('../lib/crop-bounds')

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
    const { left, top, width, height } = clampExtract({
      x,
      y,
      width: w,
      height: h,
      imgW: meta.width || w,
      imgH: meta.height || h
    })

    return {
      type: 'pipeline',
      pipeline: sharp(inputPath).extract({
        left,
        top,
        width,
        height
      })
    }
  }
}
