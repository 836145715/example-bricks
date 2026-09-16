'use strict'

/**
 * Parse #RGB / #RRGGBB / #RRGGBBAA (optional leading #).
 * @param {string} input
 * @param {{ r: number, g: number, b: number, a: number }} fallback
 */
function parseColor(input, fallback) {
  if (input == null || String(input).trim() === '') return { ...fallback }
  let s = String(input).trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (s.length === 3) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (s.length === 6) s += 'ff'
  if (!/^[0-9a-fA-F]{8}$/.test(s)) return { ...fallback }
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
    a: parseInt(s.slice(6, 8), 16),
  }
}

/**
 * Normalize to #RRGGBB or #RRGGBBAA for qrcode lib.
 * @param {string} input
 * @param {string} fallback
 */
function toHexColor(input, fallback) {
  const fb = parseColor(fallback, { r: 0, g: 0, b: 0, a: 255 })
  const c = parseColor(input, fb)
  const h = (n) => n.toString(16).padStart(2, '0')
  if (c.a >= 255) return `#${h(c.r)}${h(c.g)}${h(c.b)}`
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a)}`
}

/**
 * @param {{ r: number, g: number, b: number, a: number }} c
 */
function toRgbaTuple(c) {
  return [c.r, c.g, c.b, c.a]
}

module.exports = {
  parseColor,
  toHexColor,
  toRgbaTuple,
}
