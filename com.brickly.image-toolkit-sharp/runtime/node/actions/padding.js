'use strict'

const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'padding',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const top = typeof options.top === 'number' ? options.top : 20
    const bottom = typeof options.bottom === 'number' ? options.bottom : 20
    const left = typeof options.left === 'number' ? options.left : 20
    const right = typeof options.right === 'number' ? options.right : 20
    const bg = options.bg || '#ffffff'

    const inputBuf = await readFileBuffer(inputPath)
    return {
      type: 'pipeline',
      pipeline: sharp(inputBuf).extend({ top, bottom, left, right, background: bg })
    }
  }
}
