'use strict'

const fs = require('node:fs')
const path = require('node:path')
const QRCode = require('qrcode')
const { toHexColor } = require('./colors')
const { renderModulesPng } = require('./render-modules')

const EC_LEVELS = new Set(['L', 'M', 'Q', 'H'])
const MODULE_STYLES = new Set(['square', 'rounded', 'dots'])

/**
 * @param {{
 *   text?: string
 *   size?: number
 *   margin?: number
 *   errorCorrection?: string
 *   darkColor?: string
 *   lightColor?: string
 *   moduleStyle?: string
 *   output?: { mode?: string, dir?: string, fileName?: string }
 * }} input
 */
async function generateQr(input) {
  try {
    const src = input || {}
    const text = src.text == null ? '' : String(src.text)
    if (!text) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'text 不能为空' },
      }
    }

    let size = Number(src.size)
    if (!Number.isFinite(size)) size = 256
    size = Math.round(size)
    if (size < 64 || size > 2048) {
      return {
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'size 须在 64–2048 之间' },
      }
    }

    let margin = Number(src.margin)
    if (!Number.isFinite(margin)) margin = 2
    margin = Math.max(0, Math.min(16, Math.round(margin)))

    let ec = String(src.errorCorrection || 'M').toUpperCase()
    if (!EC_LEVELS.has(ec)) ec = 'M'

    let moduleStyle = String(src.moduleStyle || 'square').toLowerCase()
    if (!MODULE_STYLES.has(moduleStyle)) moduleStyle = 'square'

    const darkColor = toHexColor(src.darkColor, '#000000')
    const lightColor = toHexColor(src.lightColor, '#ffffff')

    /** @type {string} */
    let dataUrl
    /** @type {number} */
    let outSize = size

    if (moduleStyle === 'square') {
      // 标准方形：走 qrcode 高质量路径
      dataUrl = await QRCode.toDataURL(text, {
        width: size,
        margin,
        errorCorrectionLevel: ec,
        color: { dark: darkColor, light: lightColor },
        type: 'image/png',
      })
    } else {
      const qr = QRCode.create(text, { errorCorrectionLevel: ec })
      const pngBuf = renderModulesPng({
        modules: qr.modules,
        pixelSize: size,
        margin,
        darkColor,
        lightColor,
        moduleStyle,
      })
      dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`
      // 实际尺寸为整数 cell 对齐后的边长
      const { PNG } = require('pngjs')
      try {
        const meta = PNG.sync.read(pngBuf)
        if (meta && meta.width) outSize = meta.width
      } catch (_) {
        /* keep requested size */
      }
    }

    const output = src.output || {}
    const mode = output.mode === 'dir' ? 'dir' : 'memory'
    /** @type {string|undefined} */
    let outputPath

    if (mode === 'dir') {
      const dir = output.dir ? String(output.dir).trim() : ''
      if (!dir) {
        return {
          ok: false,
          error: { code: 'INVALID_INPUT', message: 'mode=dir 时必须提供 output.dir' },
        }
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const fileName =
        (output.fileName && String(output.fileName).trim()) ||
        `qr-${Date.now()}.png`
      const safeName = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      outputPath = path.join(dir, safeName.endsWith('.png') ? safeName : `${safeName}.png`)

      const comma = dataUrl.indexOf(',')
      const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
      fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'))
    }

    return {
      ok: true,
      dataUrl,
      outputPath,
      size: outSize,
      style: {
        moduleStyle,
        darkColor,
        lightColor,
        margin,
        errorCorrection: ec,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'GENERATE_FAILED',
        message: e && e.message ? e.message : String(e),
      },
    }
  }
}

module.exports = { generateQr, MODULE_STYLES }
