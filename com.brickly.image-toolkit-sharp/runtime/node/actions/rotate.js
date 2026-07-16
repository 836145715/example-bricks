'use strict'

const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'rotate',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const angle = typeof options.angle === 'number' ? options.angle : 90
    const bg = options.bg || '#00000000'

    const inputBuf = await readFileBuffer(inputPath)
    // Explicit angle rotate (autoOrient already applied on buffer open if enabled)
    return {
      type: 'pipeline',
      pipeline: sharp(inputBuf).rotate(angle, { background: bg })
    }
  }
}
