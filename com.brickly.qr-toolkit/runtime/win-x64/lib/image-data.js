'use strict'

const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')

/**
 * @param {Buffer} buffer
 * @param {string} [hint] file extension or mime hint
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 */
function bufferToRgba(buffer, hint = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('图片数据为空')
    err.code = 'INVALID_INPUT'
    throw err
  }

  const lower = String(hint || '').toLowerCase()
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8

  if (isPng || lower.includes('png')) {
    try {
      const png = PNG.sync.read(buffer)
      return {
        data: new Uint8ClampedArray(png.data),
        width: png.width,
        height: png.height,
      }
    } catch (e) {
      const err = new Error(e && e.message ? e.message : 'PNG 解析失败')
      err.code = 'DECODE_FAILED'
      throw err
    }
  }

  if (isJpeg || lower.includes('jpg') || lower.includes('jpeg')) {
    try {
      const raw = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256 })
      if (!raw || !raw.data || !raw.width || !raw.height) {
        const err = new Error('JPEG 解析失败')
        err.code = 'DECODE_FAILED'
        throw err
      }
      return {
        data: new Uint8ClampedArray(raw.data),
        width: raw.width,
        height: raw.height,
      }
    } catch (e) {
      if (e && e.code) throw e
      const err = new Error(e && e.message ? e.message : 'JPEG 解析失败')
      err.code = 'DECODE_FAILED'
      throw err
    }
  }

  const err = new Error('仅支持 PNG / JPEG 图片')
  err.code = 'UNSUPPORTED_FORMAT'
  throw err
}

/**
 * @param {string} imageBase64
 * @returns {{ buffer: Buffer, hint: string }}
 */
function parseBase64Image(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    const err = new Error('imageBase64 无效')
    err.code = 'INVALID_INPUT'
    throw err
  }

  let hint = ''
  let payload = imageBase64.trim()
  const m = /^data:([^;]+);base64,(.+)$/i.exec(payload)
  if (m) {
    hint = m[1]
    payload = m[2]
  }

  try {
    const buffer = Buffer.from(payload, 'base64')
    if (!buffer.length) {
      const err = new Error('imageBase64 解码为空')
      err.code = 'INVALID_INPUT'
      throw err
    }
    return { buffer, hint }
  } catch (e) {
    if (e && e.code) throw e
    const err = new Error('imageBase64 不是合法 Base64')
    err.code = 'INVALID_INPUT'
    throw err
  }
}

module.exports = {
  bufferToRgba,
  parseBase64Image,
}
