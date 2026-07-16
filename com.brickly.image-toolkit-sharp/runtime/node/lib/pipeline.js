'use strict'

const fs = require('node:fs/promises')
const { loadSharp } = require('./sharp-loader')

/**
 * Open an image file as a sharp pipeline.
 * @param {string} filePath
 * @param {{ autoOrient?: boolean }} [opts]
 * @returns {import('sharp').Sharp}
 */
function openImage (filePath, { autoOrient = true } = {}) {
  const sharp = loadSharp()
  let pipeline = sharp(filePath)
  // .rotate() with no args applies EXIF orientation and clears the tag
  if (autoOrient) {
    pipeline = pipeline.rotate()
  }
  return pipeline
}

/**
 * Optionally strip metadata from a sharp pipeline (sharp 0.33 compatible).
 * When strip is true, rely on sharp's default re-encode path which drops
 * EXIF/ICC/IPTC/XMP unless withMetadata() is called.
 * When strip is false, keep existing metadata via withMetadata().
 *
 * @param {import('sharp').Sharp} pipeline
 * @param {boolean} strip
 * @returns {import('sharp').Sharp}
 */
function applyStripMetadata (pipeline, strip) {
  if (!strip) {
    return pipeline.withMetadata()
  }
  // Default sharp re-encode already omits most metadata when withMetadata is not used.
  // Explicit no-op keeps the pipeline chain clear for callers.
  return pipeline
}

/**
 * Write pipeline to disk and return size / dimension stats.
 * @param {import('sharp').Sharp} pipeline
 * @param {string} outPath
 * @returns {Promise<{ outputPath: string, sizeBytes: number, sizeKb: number, width: number|null, height: number|null, format: string|null }>}
 */
async function writeAndStat (pipeline, outPath) {
  await pipeline.toFile(outPath)
  const sharp = loadSharp()
  const finalStat = await fs.stat(outPath)
  const finalMeta = await sharp(outPath).metadata().catch(() => ({}))
  return {
    outputPath: outPath,
    sizeBytes: finalStat.size,
    sizeKb: Math.round((finalStat.size / 1024) * 100) / 100,
    width: finalMeta.width || null,
    height: finalMeta.height || null,
    format: finalMeta.format || null
  }
}

module.exports = { openImage, applyStripMetadata, writeAndStat }
