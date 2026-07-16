'use strict'

/**
 * Compress image with lossy encoding that actually shrinks files.
 *
 * Why the old path felt "useless":
 * - PNG used only compressionLevel (lossless) → photos barely shrink
 * - JPEG quality 80 on already-compressed phone JPEGs often stays ~same size
 * - No format switch → cannot leave PNG "photo" trap
 *
 * Strategy:
 * - Prefer lossy JPEG (mozjpeg) / WebP unless user forces "keep"
 * - PNG with alpha → WebP; PNG opaque → JPEG by default
 * - targetSizeKb binary-search works on jpeg/webp/avif output
 */

/**
 * @param {import('sharp').Sharp} sharpCtor
 * @param {string} inputPath
 * @param {string} outFormat jpeg|webp|avif|png
 * @param {number} quality
 * @param {object} meta
 */
function encodePipeline (sharpCtor, inputPath, outFormat, quality, meta) {
  let pipeline = sharpCtor(inputPath)
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
  // PNG: palette quantization when quality < 100 helps screenshots; still weaker than JPEG for photos
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

  // Fallback: re-encode original format lossy if possible
  const fmt = meta.format || 'jpeg'
  if (fmt === 'jpeg' || fmt === 'jpg') {
    return pipeline.jpeg({ quality: q, mozjpeg: true })
  }
  if (fmt === 'webp') return pipeline.webp({ quality: q })
  return pipeline.toFormat(fmt, { quality: q })
}

/**
 * Pick output format for compression.
 * @param {object} options
 * @param {{ format?: string, hasAlpha?: boolean }} meta
 * @returns {'jpeg'|'webp'|'avif'|'png'}
 */
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
    // keep-but-uncompressible (tiff/heif/...) → jpeg
    return hasAlpha ? 'webp' : 'jpeg'
  }

  // auto: make size drop for typical user photos
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

  /**
   * @param {object} ctx
   * @returns {Promise<{ type: 'pipeline', pipeline: import('sharp').Sharp, format?: string } | { type: 'buffer', buffer: Buffer, format?: string }>}
   */
  async run (ctx) {
    const sharp = ctx.loadSharp()
    const { inputPath, options = {} } = ctx
    // Default 70: more noticeable than 80 on already-compressed camera JPEGs
    const quality = typeof options.quality === 'number' ? options.quality : 70
    const targetSizeKb =
      typeof options.targetSizeKb === 'number' && options.targetSizeKb > 0
        ? options.targetSizeKb
        : null

    const meta = await sharp(inputPath).metadata()
    const outFormat = resolveOutFormat(options, meta)

    if (targetSizeKb && ['jpeg', 'webp', 'avif'].includes(outFormat)) {
      let minQ = 5
      let maxQ = 100
      let bestBuffer = null
      const targetBytes = targetSizeKb * 1024

      for (let iter = 0; iter < 8; iter++) {
        if (typeof ctx.ensureNotCancelled === 'function') ctx.ensureNotCancelled()
        const currentQ = Math.round((minQ + maxQ) / 2)
        const buf = await encodePipeline(sharp, inputPath, outFormat, currentQ, meta).toBuffer()
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
      // Still too large at q=5: emit lowest quality
      const low = await encodePipeline(sharp, inputPath, outFormat, 5, meta).toBuffer()
      return { type: 'buffer', buffer: low, format: outFormat }
    }

    return {
      type: 'pipeline',
      pipeline: encodePipeline(sharp, inputPath, outFormat, quality, meta),
      format: outFormat
    }
  }
}
