'use strict'

const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'flip',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const horizontal = !!options.horizontal
    const vertical = !!options.vertical

    const inputBuf = await readFileBuffer(inputPath)
    let pipeline = sharp(inputBuf)
    if (vertical) pipeline = pipeline.flip()
    if (horizontal) pipeline = pipeline.flop()

    return { type: 'pipeline', pipeline }
  }
}
