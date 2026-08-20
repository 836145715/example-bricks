'use strict'

/**
 * Clamp extract rectangle to image bounds.
 * Ensures left/top stay in-image and width/height are at least 1 and do not overflow.
 *
 * @param {{ x: number, y: number, width: number, height: number, imgW: number, imgH: number }} params
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
function clampExtract ({ x, y, width, height, imgW, imgH }) {
  const left = Math.max(0, Math.min(x, imgW - 1))
  const top = Math.max(0, Math.min(y, imgH - 1))
  const w = Math.max(1, Math.min(width, imgW - left))
  const h = Math.max(1, Math.min(height, imgH - top))
  return { left, top, width: w, height: h }
}

module.exports = { clampExtract }
