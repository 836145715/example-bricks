'use strict'

const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'roundedCorners',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const radius = typeof options.radius === 'number' ? options.radius : 30
    const bg = options.bg || '#00000000'

    const inputBuf = await readFileBuffer(inputPath)
    const meta = await sharp(inputBuf).metadata()
    const w = meta.width || 800
    const h = meta.height || 600

    const maskSvg = `
        <svg width="${w}" height="${h}">
          <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff" />
        </svg>
      `
    const maskBuffer = Buffer.from(maskSvg, 'utf8')

    let pipeline = sharp(inputBuf).composite([{ input: maskBuffer, blend: 'dest-in' }])

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
