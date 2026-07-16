'use strict'

const fs = require('node:fs/promises')
const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'gif',
  mode: 'multi',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, files, options = {} } = ctx
    if (!files || !files.length) throw new Error('gif requires ctx.files')

    const delay = typeof options.delay === 'number' ? options.delay : 200
    const primary = inputPath || files[0]

    const primaryBuf = await readFileBuffer(primary)
    const firstMeta = await sharp(primaryBuf).metadata()
    const w = firstMeta.width || 500
    const h = firstMeta.height || 500

    const frameBuffers = []
    for (let i = 0; i < files.length; i++) {
      if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
      const f = files[i]
      await fs.access(f)
      const buf = await readFileBuffer(f)
      const frame = await sharp(buf).resize({ width: w, height: h, fit: 'fill' }).png().toBuffer()
      frameBuffers.push(frame)
    }

    const tallBuffer = await sharp({
      create: {
        width: w,
        height: h * files.length,
        channels: 4,
        background: '#00000000'
      }
    })
      .composite(
        frameBuffers.map((buf, i) => ({
          input: buf,
          left: 0,
          top: i * h
        }))
      )
      .png()
      .toBuffer()

    return {
      type: 'pipeline',
      pipeline: sharp(tallBuffer, {
        animated: true,
        pageHeight: h
      }).gif({
        delay,
        loop: 0
      })
    }
  }
}
