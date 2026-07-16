'use strict'

/**
 * Re-export the source image as a pipeline.
 * Actual EXIF/metadata stripping is applied by pipeline.applyStripMetadata at the batch layer.
 */
module.exports = {
  id: 'stripMeta',
  mode: 'per-file',

  /**
   * @param {object} ctx
   * @param {string} ctx.inputPath
   * @param {function} ctx.loadSharp
   * @returns {Promise<{ type: 'pipeline', pipeline: import('sharp').Sharp }>}
   */
  async run (ctx) {
    const sharp = ctx.loadSharp()
    return {
      type: 'pipeline',
      pipeline: sharp(ctx.inputPath)
    }
  }
}
