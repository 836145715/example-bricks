'use strict'

const fs = require('node:fs/promises')
const { readFileBuffer } = require('../lib/pipeline')

/**
 * Multi-frame animated GIF via gifenc (true multi-frame, not a tall strip).
 * Preview uses first frame still image.
 */
module.exports = {
  id: 'gif',
  mode: 'multi',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, files, options = {} } = ctx
    if (!files || !files.length) throw new Error('gif requires ctx.files')

    let GIFEncoder
    let quantize
    let applyPalette
    try {
      ;({ GIFEncoder, quantize, applyPalette } = require('gifenc'))
    } catch (e) {
      const err = new Error(
        '缺少 gifenc 依赖，请在 runtime/node 下执行 npm install'
      )
      err.code = 'NATIVE_DEP_MISSING'
      throw err
    }

    const delay = typeof options.delay === 'number' ? Math.max(20, options.delay) : 200
    const primary = inputPath || files[0]

    const primaryBuf = await readFileBuffer(primary)
    const firstMeta = await sharp(primaryBuf).metadata()
    const w = Math.max(1, Math.min(800, firstMeta.width || 500))
    const h = Math.max(1, Math.min(800, firstMeta.height || 500))

    const gif = GIFEncoder()
    let firstFramePng = null

    for (let i = 0; i < files.length; i++) {
      if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
      const f = files[i]
      await fs.access(f)
      const buf = await readFileBuffer(f)

      const { data, info } = await sharp(buf)
        .resize({ width: w, height: h, fit: 'cover', position: 'centre' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      if (i === 0) {
        firstFramePng = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 }
        })
          .png()
          .toBuffer()
      }

      // quantize RGBA → palette index
      const palette = quantize(data, 256)
      const index = applyPalette(data, palette)
      gif.writeFrame(index, info.width, info.height, {
        palette,
        delay: Math.round(delay / 10), // gifenc delay unit: 1/100s
        dispose: 1
      })
    }

    gif.finish()
    const gifBuffer = Buffer.from(gif.bytes())

    return {
      type: 'buffer',
      buffer: gifBuffer,
      format: 'gif',
      previewBuffer: firstFramePng,
      previewFormat: 'png'
    }
  }
}
