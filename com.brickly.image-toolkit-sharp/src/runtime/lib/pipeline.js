'use strict'

const fs = require('node:fs/promises')
const { loadSharp } = require('./sharp-loader')

/**
 * Read file fully into memory so libvips never holds a path-based file handle.
 * Prefer this over sharp(filePath) on Windows.
 * @param {string} filePath
 * @returns {Promise<Buffer>}
 */
async function readFileBuffer (filePath) {
  return fs.readFile(filePath)
}

/**
 * Open an image as a sharp pipeline from a path without keeping the path open:
 * read → buffer → sharp(buffer).
 * @param {string} filePath
 * @param {{ autoOrient?: boolean }} [opts]
 * @returns {Promise<import('sharp').Sharp>}
 */
async function openImage (filePath, { autoOrient = true } = {}) {
  const sharp = loadSharp()
  const buffer = await readFileBuffer(filePath)
  let pipeline = sharp(buffer)
  if (autoOrient) {
    pipeline = pipeline.rotate()
  }
  return pipeline
}

/**
 * @param {import('sharp').Sharp} pipeline
 * @param {boolean} strip
 * @returns {import('sharp').Sharp}
 */
function applyStripMetadata (pipeline, strip) {
  if (!strip) {
    return pipeline.withMetadata()
  }
  return pipeline
}

/**
 * Write pipeline to disk. Use toFile() info only — do NOT sharp(outPath) again
 * (that re-locks the output file on Windows until GC).
 *
 * @param {import('sharp').Sharp} pipeline
 * @param {string} outPath
 * @returns {Promise<{ outputPath: string, sizeBytes: number, sizeKb: number, width: number|null, height: number|null, format: string|null }>}
 */
async function writeAndStat (pipeline, outPath) {
  // toFile returns { format, width, height, size, ... } and closes the output stream
  const info = await pipeline.toFile(outPath)

  // Prefer info.size; fall back to stat without opening via sharp
  let sizeBytes = typeof info.size === 'number' ? info.size : 0
  if (!sizeBytes) {
    try {
      const st = await fs.stat(outPath)
      sizeBytes = st.size
    } catch (_) {
      sizeBytes = 0
    }
  }

  return {
    outputPath: outPath,
    sizeBytes,
    sizeKb: Math.round((sizeBytes / 1024) * 100) / 100,
    width: info.width != null ? info.width : null,
    height: info.height != null ? info.height : null,
    format: info.format || null
  }
}

/**
 * Stat a file already on disk without holding a sharp path handle.
 * Dimensions: decode from buffer then drop references (no path cache).
 *
 * @param {string} outPath
 */
async function statOnDisk (outPath) {
  const finalStat = await fs.stat(outPath)
  let width = null
  let height = null
  let format = null
  try {
    const sharp = loadSharp()
    const buf = await fs.readFile(outPath)
    const meta = await sharp(buf).metadata()
    width = meta.width || null
    height = meta.height || null
    format = meta.format || null
    // buf goes out of scope; no path-based handle
  } catch (_) {
    /* pdf or non-image */
  }
  return {
    outputPath: outPath,
    sizeBytes: finalStat.size,
    sizeKb: Math.round((finalStat.size / 1024) * 100) / 100,
    width,
    height,
    format
  }
}

function mimeForFormat (format) {
  const fmt = String(format || '').toLowerCase()
  if (fmt === 'jpg' || fmt === 'jpeg') return 'image/jpeg'
  if (fmt === 'png') return 'image/png'
  if (fmt === 'webp') return 'image/webp'
  if (fmt === 'gif') return 'image/gif'
  if (fmt === 'avif') return 'image/avif'
  return 'image/jpeg'
}

/**
 * Build a data-URL for UI preview.
 *
 * - faithful=true (memory preview): keep processed pixels/format as much as possible
 *   so compress/watermark/rotate effects are actually visible. Only downscale if huge.
 * - faithful=false (saved-file list thumbs): smaller JPEG thumbnail.
 *
 * @param {string | Buffer} source
 * @param {string | null | undefined} format
 * @param {{ faithful?: boolean, maxEdge?: number, maxBytes?: number }} [opts]
 * @returns {Promise<string | null>}
 */
async function makePreviewDataUrl (source, format, opts = {}) {
  const fmt = String(format || '').toLowerCase()
  if (fmt === 'pdf') return null
  if (typeof source === 'string') {
    const lower = source.toLowerCase()
    if (lower.endsWith('.pdf')) return null
  }

  try {
    const sharp = loadSharp()
    const input =
      typeof source === 'string' ? await fs.readFile(source) : source
    if (!Buffer.isBuffer(input) || input.length === 0) return null

    const faithful = !!opts.faithful
    const maxEdge = opts.maxEdge || (faithful ? 1600 : 1280)
    const maxBytes = opts.maxBytes || (faithful ? 2.5 * 1024 * 1024 : 800 * 1024)

    const mime = mimeForFormat(fmt)

    // Animated GIF: pass through as data:image/gif so the browser plays frames.
    // Cap size to keep IPC/UI responsive; oversize falls back to first frame still.
    if (fmt === 'gif') {
      const gifMax = opts.maxBytes || 4 * 1024 * 1024
      if (Buffer.isBuffer(input) && input.length > 0 && input.length <= gifMax) {
        return `data:image/gif;base64,${input.toString('base64')}`
      }
      try {
        const frame = await sharp(input, { animated: true, pages: 1, page: 0 })
          .rotate()
          .resize({
            width: maxEdge,
            height: maxEdge,
            fit: 'inside',
            withoutEnlargement: true
          })
          .png()
          .toBuffer()
        return `data:image/png;base64,${frame.toString('base64')}`
      } catch (_) {
        return null
      }
    }

    // Small enough + known web mime: use encoded buffer as-is (true processing look)
    if (
      faithful &&
      Buffer.isBuffer(source) &&
      source.length <= maxBytes &&
      ['jpeg', 'jpg', 'png', 'webp'].includes(fmt)
    ) {
      return `data:${mime};base64,${source.toString('base64')}`
    }

    let pipeline = sharp(input, { animated: false, pages: 1 }).rotate().resize({
      width: maxEdge,
      height: maxEdge,
      fit: 'inside',
      withoutEnlargement: true
    })

    // Prefer keeping target format when faithful (e.g. webp compress result stays webp)
    let outBuf
    let outMime = 'image/jpeg'
    if (faithful && (fmt === 'png' || fmt === 'webp' || fmt === 'jpeg' || fmt === 'jpg')) {
      if (fmt === 'png') {
        outBuf = await pipeline.png({ compressionLevel: 8 }).toBuffer()
        outMime = 'image/png'
      } else if (fmt === 'webp') {
        outBuf = await pipeline.webp({ quality: 82 }).toBuffer()
        outMime = 'image/webp'
      } else {
        outBuf = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
        outMime = 'image/jpeg'
      }
    } else {
      outBuf = await pipeline.jpeg({ quality: faithful ? 85 : 72, mozjpeg: true }).toBuffer()
      outMime = 'image/jpeg'
    }

    if (outBuf.length > maxBytes && faithful) {
      // Still too big: force smaller jpeg
      outBuf = await sharp(outBuf)
        .resize({ width: 1200, height: 1200, fit: 'inside' })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer()
      outMime = 'image/jpeg'
    }

    return `data:${outMime};base64,${outBuf.toString('base64')}`
  } catch (_) {
    return null
  }
}

module.exports = {
  openImage,
  readFileBuffer,
  applyStripMetadata,
  writeAndStat,
  statOnDisk,
  makePreviewDataUrl,
  mimeForFormat
}
