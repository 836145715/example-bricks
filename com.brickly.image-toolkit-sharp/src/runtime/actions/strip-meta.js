'use strict'

const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'stripMeta',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const inputBuf = await readFileBuffer(ctx.inputPath)
    // Re-encode path; batch forces stripMetadata=true
    return {
      type: 'pipeline',
      pipeline: sharp(inputBuf)
    }
  }
}
