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

module.exports = {
  openImage,
  readFileBuffer,
  applyStripMetadata,
  writeAndStat,
  statOnDisk
}
