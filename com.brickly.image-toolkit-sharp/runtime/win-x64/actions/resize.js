'use strict'

const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'resize',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const width = typeof options.width === 'number' ? options.width : null
    const height = typeof options.height === 'number' ? options.height : null
    const keepRatio = options.keepRatio !== false
    const scale = typeof options.scale === 'number' ? options.scale : null
    const fit = options.fit || 'contain'
    const bg = options.bg || '#00000000'

    const inputBuf = await readFileBuffer(inputPath)
    const meta = await sharp(inputBuf).metadata()
    let targetW = width
    let targetH = height

    if (scale) {
      targetW = Math.max(1, Math.round((meta.width || 640) * (scale / 100)))
      targetH = keepRatio ? null : Math.max(1, Math.round((meta.height || 480) * (scale / 100)))
    }

    const resizeOpts = { fit, background: bg }
    if (targetW) resizeOpts.width = targetW
    if (targetH) resizeOpts.height = targetH
    if (keepRatio && targetW && targetH) {
      resizeOpts.fit = 'contain'
    } else if (!keepRatio) {
      resizeOpts.fit = 'fill'
    }

    return {
      type: 'pipeline',
      pipeline: sharp(inputBuf).resize(resizeOpts)
    }
  }
}
