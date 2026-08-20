'use strict'

const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'convert',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const format = options.format || 'webp'
    const quality = typeof options.quality === 'number' ? options.quality : 82
    const lossless = !!options.lossless

    const inputBuf = await readFileBuffer(inputPath)
    let pipeline = sharp(inputBuf)

    if (format === 'jpeg' || format === 'jpg') {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true })
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ quality, lossless })
    } else if (format === 'png') {
      pipeline = pipeline.png({ compressionLevel: 9 })
    } else if (format === 'avif') {
      pipeline = pipeline.avif({ quality, lossless })
    } else if (format === 'gif') {
      pipeline = pipeline.gif()
    } else {
      pipeline = pipeline.toFormat(format, { quality })
    }

    return { type: 'pipeline', pipeline, format }
  }
}
