'use strict'

const fs = require('node:fs')
const path = require('node:path')
const jsQR = require('jsqr')
const { bufferToRgba, parseBase64Image } = require('./image-data')

/**
 * @param {{ filePath?: string, imageBase64?: string }} input
 * @returns {{ ok: true, text: string } | { ok: false, error: { code: string, message: string } }}
 */
function decodeQr(input) {
  try {
    const src = input || {}
    const filePath = src.filePath ? String(src.filePath).trim() : ''
    const imageBase64 = src.imageBase64 ? String(src.imageBase64) : ''

    if (!filePath && !imageBase64) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: '请提供 filePath 或 imageBase64' },
      }
    }

    /** @type {Buffer} */
    let buffer
    /** @type {string} */
    let hint = ''

    if (filePath) {
      if (!fs.existsSync(filePath)) {
        return {
          ok: false,
          error: { code: 'FILE_NOT_FOUND', message: `文件不存在: ${filePath}` },
        }
      }
      buffer = fs.readFileSync(filePath)
      hint = path.extname(filePath)
    } else {
      const parsed = parseBase64Image(imageBase64)
      buffer = parsed.buffer
      hint = parsed.hint
    }

    const { data, width, height } = bufferToRgba(buffer, hint)
    const code = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
    if (!code || !code.data) {
      return {
        ok: false,
        error: { code: 'NO_QR_FOUND', message: '未识别到二维码' },
      }
    }

    return { ok: true, text: String(code.data) }
  } catch (e) {
    const code = (e && e.code) || 'DECODE_FAILED'
    const message = e && e.message ? e.message : String(e)
    return { ok: false, error: { code: String(code), message } }
  }
}

module.exports = { decodeQr }
