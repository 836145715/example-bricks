'use strict'

const { readFileBuffer } = require('../lib/pipeline')
const { clampExtract } = require('../lib/crop-bounds')

module.exports = {
  id: 'crop',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const x = typeof options.x === 'number' ? options.x : 0
    const y = typeof options.y === 'number' ? options.y : 0
    const w = typeof options.width === 'number' ? options.width : 200
    const h = typeof options.height === 'number' ? options.height : 200

    const inputBuf = await readFileBuffer(inputPath)
    const meta = await sharp(inputBuf).metadata()
    const region = clampExtract({
      x,
      y,
      width: w,
      height: h,
      imgW: meta.width || w,
      imgH: meta.height || h
    })

    return {
      type: 'pipeline',
      pipeline: sharp(inputBuf).extract(region)
    }
  }
}
