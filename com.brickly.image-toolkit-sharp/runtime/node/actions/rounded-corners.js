'use strict'

/**
 * Apply rounded-corner mask; optional solid background under transparency.
 */
module.exports = {
  id: 'roundedCorners',
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
    const radius = typeof options.radius === 'number' ? options.radius : 30
    const bg = options.bg || '#00000000'

    const meta = await sharp(inputPath).metadata()
    const w = meta.width || 800
    const h = meta.height || 600

    const maskSvg = `
        <svg width="${w}" height="${h}">
          <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff" />
        </svg>
      `
    const maskBuffer = Buffer.from(maskSvg, 'utf8')

    let pipeline = sharp(inputPath).composite([{ input: maskBuffer, blend: 'dest-in' }])

    if (bg !== '#00000000' && bg !== 'transparent') {
      const roundedBuffer = await pipeline.png().toBuffer()
      pipeline = sharp({
        create: {
          width: w,
          height: h,
          channels: 4,
          background: bg
        }
      }).composite([{ input: roundedBuffer }])
    }

    return { type: 'pipeline', pipeline }
  }
}
