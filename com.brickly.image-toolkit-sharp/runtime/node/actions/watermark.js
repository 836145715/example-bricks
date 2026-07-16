'use strict'

const fs = require('node:fs/promises')
const { readFileBuffer } = require('../lib/pipeline')

module.exports = {
  id: 'watermark',
  mode: 'per-file',

  async run (ctx) {
    const sharp = ctx.loadSharp()
    const escapeXml = ctx.escapeXml
    if (typeof escapeXml !== 'function') {
      throw new Error('watermark requires ctx.escapeXml')
    }

    const { inputPath, options = {} } = ctx
    const type = options.type || 'text'
    const opacity = typeof options.opacity === 'number' ? options.opacity : 0.5
    const gravity = options.gravity || 'centre'

    const inputBuf = await readFileBuffer(inputPath)
    const bgMeta = await sharp(inputBuf).metadata()
    const bgW = bgMeta.width || 800

    let overlayBuffer
    if (type === 'text') {
      const text = escapeXml(options.text || 'Watermark')
      const fontSize = typeof options.fontSize === 'number' ? options.fontSize : 32
      const color = options.color || '#ffffff'
      const angle = typeof options.angle === 'number' ? options.angle : 0
      const rawText = options.text || 'Watermark'
      const estimatedW = Math.round(rawText.length * fontSize * 0.75 + 40)
      const estimatedH = Math.round(fontSize * 1.6 + 40)

      const textSvg = `
          <svg width="${estimatedW}" height="${estimatedH}">
            <text x="50%" y="50%"
                  font-family="PingFang SC, Microsoft YaHei, sans-serif"
                  font-weight="bold"
                  font-size="${fontSize}"
                  fill="${color}"
                  fill-opacity="${opacity}"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  transform="rotate(${angle}, ${estimatedW / 2}, ${estimatedH / 2})">
              ${text}
            </text>
          </svg>
        `
      overlayBuffer = Buffer.from(textSvg, 'utf8')
    } else {
      const watermarkFile = options.watermarkFile
      if (!watermarkFile) throw new Error('图片水印必须提供 watermarkFile 路径')
      await fs.access(watermarkFile)

      const wmScale = typeof options.watermarkScale === 'number' ? options.watermarkScale : 20
      const wmW = Math.max(10, Math.round(bgW * (wmScale / 100)))

      const wmBuf = await readFileBuffer(watermarkFile)
      const resizedWmBuffer = await sharp(wmBuf).resize({ width: wmW }).png().toBuffer()

      const wmMeta = await sharp(resizedWmBuffer).metadata()
      const w = wmMeta.width || wmW
      const h = wmMeta.height || wmW
      const dataUrl = `data:image/png;base64,${resizedWmBuffer.toString('base64')}`
      const imgSvg = `
          <svg width="${w}" height="${h}">
            <image href="${dataUrl}" width="${w}" height="${h}" opacity="${opacity}" />
          </svg>
        `
      overlayBuffer = Buffer.from(imgSvg, 'utf8')
    }

    return {
      type: 'pipeline',
      pipeline: sharp(inputBuf).composite([{ input: overlayBuffer, gravity }])
    }
  }
}
