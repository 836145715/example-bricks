'use strict'

const { PNG } = require('pngjs')
const { parseColor, toRgbaTuple } = require('./colors')

/**
 * Draw filled circle (integer raster).
 * @param {PNG} png
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {[number, number, number, number]} rgba
 */
function fillCircle(png, cx, cy, radius, rgba) {
  const r2 = radius * radius
  const x0 = Math.max(0, Math.floor(cx - radius - 1))
  const y0 = Math.max(0, Math.floor(cy - radius - 1))
  const x1 = Math.min(png.width - 1, Math.ceil(cx + radius + 1))
  const y1 = Math.min(png.height - 1, Math.ceil(cy + radius + 1))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r2) {
        const idx = (png.width * y + x) << 2
        png.data[idx] = rgba[0]
        png.data[idx + 1] = rgba[1]
        png.data[idx + 2] = rgba[2]
        png.data[idx + 3] = rgba[3]
      }
    }
  }
}

/**
 * Filled rounded rect.
 * @param {PNG} png
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} radius
 * @param {[number, number, number, number]} rgba
 */
function fillRoundedRect(png, x, y, w, h, radius, rgba) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(png.width - 1, Math.ceil(x + w))
  const y1 = Math.min(png.height - 1, Math.ceil(y + h))
  const r2 = r * r
  const left = x + r
  const right = x + w - r
  const top = y + r
  const bottom = y + h - r

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5
      const cy = py + 0.5
      let inside = false
      if (cx >= left && cx <= right && cy >= y && cy <= y + h) inside = true
      else if (cy >= top && cy <= bottom && cx >= x && cx <= x + w) inside = true
      else {
        // corners
        const corners = [
          [left, top],
          [right, top],
          [left, bottom],
          [right, bottom],
        ]
        for (const [kx, ky] of corners) {
          const dx = cx - kx
          const dy = cy - ky
          if (dx * dx + dy * dy <= r2) {
            inside = true
            break
          }
        }
      }
      if (!inside) continue
      const idx = (png.width * py + px) << 2
      png.data[idx] = rgba[0]
      png.data[idx + 1] = rgba[1]
      png.data[idx + 2] = rgba[2]
      png.data[idx + 3] = rgba[3]
    }
  }
}

/**
 * Filled axis-aligned rect.
 */
function fillRect(png, x, y, w, h, rgba) {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(png.width, Math.ceil(x + w))
  const y1 = Math.min(png.height, Math.ceil(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const idx = (png.width * py + px) << 2
      png.data[idx] = rgba[0]
      png.data[idx + 1] = rgba[1]
      png.data[idx + 2] = rgba[2]
      png.data[idx + 3] = rgba[3]
    }
  }
}

/**
 * Whether (row,col) is in a finder pattern (7x7 corner squares).
 */
function isFinderModule(row, col, size) {
  const inTL = row < 7 && col < 7
  const inTR = row < 7 && col >= size - 7
  const inBL = row >= size - 7 && col < 7
  return inTL || inTR || inBL
}

/**
 * Structural modules stay square for scan reliability (finder + separators + timing).
 */
function isStructuralModule(row, col, size) {
  if (isFinderModule(row, col, size)) return true
  // separators around finders (row/col index 7)
  if (row === 7 && (col < 8 || col >= size - 8)) return true
  if (col === 7 && (row < 8 || row >= size - 8)) return true
  if (row < 8 && col === size - 8) return true
  if (col < 8 && row === size - 8) return true
  // timing patterns
  if (row === 6 || col === 6) return true
  return false
}

/**
 * @param {object} opts
 * @param {{ size: number, get: (row: number, col: number) => boolean }} opts.modules
 * @param {number} opts.pixelSize
 * @param {number} opts.margin
 * @param {string} opts.darkColor
 * @param {string} opts.lightColor
 * @param {'square'|'rounded'|'dots'} opts.moduleStyle
 * @returns {Buffer} PNG buffer
 */
function renderModulesPng(opts) {
  const modules = opts.modules
  const moduleCount = modules.size
  const margin = Math.max(0, Math.round(opts.margin || 0))
  const total = moduleCount + margin * 2
  // 整数 cell，避免亚像素导致扫码失败
  const scale = Math.max(1, Math.floor((opts.pixelSize || 256) / total))
  const pixelSize = total * scale
  const cell = scale
  const style = opts.moduleStyle || 'square'

  const dark = toRgbaTuple(parseColor(opts.darkColor, { r: 0, g: 0, b: 0, a: 255 }))
  const light = toRgbaTuple(parseColor(opts.lightColor, { r: 255, g: 255, b: 255, a: 255 }))

  const png = new PNG({ width: pixelSize, height: pixelSize })
  // fill background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = light[0]
    png.data[i + 1] = light[1]
    png.data[i + 2] = light[2]
    png.data[i + 3] = light[3]
  }

  const gap = style === 'square' ? 0 : Math.max(0, Math.floor(cell * 0.06))
  const radius = Math.max(1, Math.floor(cell * 0.32))

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!modules.get(row, col)) continue
      const x = (col + margin) * cell
      const y = (row + margin) * cell
      const structural = isStructuralModule(row, col, moduleCount)
      const drawStyle = structural ? 'square' : style

      if (drawStyle === 'dots') {
        const cx = x + cell / 2
        const cy = y + cell / 2
        // 半径略大于半格的 0.5，相邻圆轻微重叠，提高大尺寸下识别率
        fillCircle(png, cx, cy, cell * 0.5, dark)
      } else if (drawStyle === 'rounded') {
        fillRoundedRect(png, x + gap, y + gap, cell - gap * 2, cell - gap * 2, radius, dark)
      } else {
        fillRect(png, x, y, cell, cell, dark)
      }
    }
  }

  return PNG.sync.write(png)
}

module.exports = {
  renderModulesPng,
  isFinderModule,
  isStructuralModule,
}
