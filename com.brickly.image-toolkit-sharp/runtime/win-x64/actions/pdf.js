'use strict'

const fs = require('node:fs/promises')
const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'pdf',
  mode: 'multi',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { files, outputPath } = ctx
    if (!files || !files.length) throw new Error('pdf requires ctx.files')
    if (!outputPath) throw new Error('pdf requires ctx.outputPath')
    if (typeof ctx.compileJpegsToPdf !== 'function') {
      throw new Error('pdf requires ctx.compileJpegsToPdf')
    }

    const jpegBuffers = []
    for (let i = 0; i < files.length; i++) {
      if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
      const file = files[i]
      await fs.access(file)
      const buf = await readFileBuffer(file)
      const jpeg = await sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
      jpegBuffers.push(jpeg)
    }

    await ctx.compileJpegsToPdf(jpegBuffers, outputPath)
    return { type: 'written', outputPath }
  }
}
