'use strict'

const { readFileBuffer } = require('../lib/pipeline')

/**
 * Compress with lossy encoding. Always decodes from Buffer (never sharp(path))
 * so Windows can delete input/output after the job.
 */

function encodeFromBuffer (sharpCtor, inputBuf, outFormat, quality, meta) {
  let pipeline = sharpCtor(inputBuf)
  const q = Math.max(1, Math.min(100, Math.round(quality)))

  if (outFormat === 'jpeg' || outFormat === 'jpg') {
    return pipeline.jpeg({
      quality: q,
      mozjpeg: true,
      chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0'
    })
  }
  if (outFormat === 'webp') {
    return pipeline.webp({
      quality: q,
      effort: 4,
      alphaQuality: Math.min(100, q + 5)
    })
  }
  if (outFormat === 'avif') {
    return pipeline.avif({ quality: q, effort: 4 })
  }
  if (outFormat === 'png') {
    if (q < 100) {
      return pipeline.png({
        compressionLevel: 9,
        quality: q,
        palette: true,
        colours: Math.max(2, Math.min(256, Math.round((q / 100) * 256)))
      })
    }
    return pipeline.png({ compressionLevel: 9, effort: 10 })
  }

  const fmt = meta.format || 'jpeg'
  if (fmt === 'jpeg' || fmt === 'jpg') {
    return pipeline.jpeg({ quality: q, mozjpeg: true })
  }
  if (fmt === 'webp') return pipeline.webp({ quality: q })
  return pipeline.toFormat(fmt, { quality: q })
}

function resolveOutFormat (options, meta) {
  const prefer = String(options.preferFormat || options.format || 'auto').toLowerCase()
  const src = meta.format || 'jpeg'
  const hasAlpha = !!meta.hasAlpha

  if (prefer === 'jpeg' || prefer === 'jpg') return 'jpeg'
  if (prefer === 'webp') return 'webp'
  if (prefer === 'avif') return 'avif'
  if (prefer === 'png') return 'png'
  if (prefer === 'keep') {
    if (src === 'jpg') return 'jpeg'
    if (['jpeg', 'webp', 'avif', 'png'].includes(src)) return src
    return hasAlpha ? 'webp' : 'jpeg'
  }

  if (src === 'png') return hasAlpha ? 'webp' : 'jpeg'
  if (src === 'webp') return 'webp'
  if (src === 'avif') return 'avif'
  if (src === 'jpeg' || src === 'jpg') return 'jpeg'
  if (src === 'gif') return 'webp'
  return hasAlpha ? 'webp' : 'jpeg'
}

module.exports = {
  id: 'compress',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    const quality = typeof options.quality === 'number' ? options.quality : 70
    const targetSizeKb =
      typeof options.targetSizeKb === 'number' && options.targetSizeKb > 0
        ? options.targetSizeKb
        : null

    const inputBuf = await readFileBuffer(inputPath)
    const meta = await sharp(inputBuf).metadata()
    const outFormat = resolveOutFormat(options, meta)

    if (targetSizeKb && ['jpeg', 'webp', 'avif'].includes(outFormat)) {
      let minQ = 5
      let maxQ = 100
      let bestBuffer = null
      const targetBytes = targetSizeKb * 1024

      for (let iter = 0; iter < 8; iter++) {
        if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
        const currentQ = Math.round((minQ + maxQ) / 2)
        const buf = await encodeFromBuffer(sharp, inputBuf, outFormat, currentQ, meta).toBuffer()
        if (buf.length <= targetBytes) {
          bestBuffer = buf
          minQ = currentQ + 1
        } else {
          maxQ = currentQ - 1
        }
      }

      if (bestBuffer) {
        return { type: 'buffer', buffer: bestBuffer, format: outFormat }
      }
      const low = await encodeFromBuffer(sharp, inputBuf, outFormat, 5, meta).toBuffer()
      return { type: 'buffer', buffer: low, format: outFormat }
    }

    return {
      type: 'pipeline',
      pipeline: encodeFromBuffer(sharp, inputBuf, outFormat, quality, meta),
      format: outFormat
    }
  }
}
