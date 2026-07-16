'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const QRCode = require('qrcode')
const { generateQr } = require('../lib/generate')
const { decodeQr } = require('../lib/decode')

describe('generateQr', () => {
  it('returns dataUrl for memory mode', async () => {
    const result = await generateQr({ text: 'hello-brickly', size: 128 })
    assert.equal(result.ok, true)
    assert.ok(result.dataUrl.startsWith('data:image/png;base64,'))
    assert.equal(result.size, 128)
    assert.equal(result.outputPath, undefined)
  })

  it('rejects empty text', async () => {
    const result = await generateQr({ text: '' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_INPUT')
  })

  it('writes file in dir mode', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-toolkit-'))
    try {
      const result = await generateQr({
        text: 'file-out',
        size: 128,
        output: { mode: 'dir', dir, fileName: 'out.png' },
      })
      assert.equal(result.ok, true)
      assert.ok(result.outputPath)
      assert.ok(fs.existsSync(result.outputPath))
      assert.ok(fs.statSync(result.outputPath).size > 0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('supports rounded style and custom colors', async () => {
    const result = await generateQr({
      text: 'styled-qr',
      size: 200,
      moduleStyle: 'rounded',
      darkColor: '#0d9488',
      lightColor: '#ecfdf5',
    })
    assert.equal(result.ok, true)
    assert.ok(result.dataUrl.startsWith('data:image/png;base64,'))
    assert.equal(result.style.moduleStyle, 'rounded')
    // round-trip decode should still work
    const decoded = decodeQr({ imageBase64: result.dataUrl })
    assert.equal(decoded.ok, true)
    assert.equal(decoded.text, 'styled-qr')
  })

  it('supports dots style', async () => {
    const result = await generateQr({
      text: 'dots-style',
      size: 220,
      moduleStyle: 'dots',
      errorCorrection: 'H',
    })
    assert.equal(result.ok, true)
    const decoded = decodeQr({ imageBase64: result.dataUrl })
    assert.equal(decoded.ok, true)
    assert.equal(decoded.text, 'dots-style')
  })
})

describe('decodeQr', () => {
  it('decodes PNG from file path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-toolkit-'))
    const file = path.join(dir, 'sample.png')
    try {
      await QRCode.toFile(file, 'decode-me-please', {
        width: 200,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
      const result = decodeQr({ filePath: file })
      assert.equal(result.ok, true)
      assert.equal(result.text, 'decode-me-please')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('decodes from base64 data URL', async () => {
    const dataUrl = await QRCode.toDataURL('base64-payload', {
      width: 200,
      margin: 2,
    })
    const result = decodeQr({ imageBase64: dataUrl })
    assert.equal(result.ok, true)
    assert.equal(result.text, 'base64-payload')
  })

  it('returns FILE_NOT_FOUND', () => {
    const result = decodeQr({ filePath: path.join(os.tmpdir(), 'no-such-qr-file-xyz.png') })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'FILE_NOT_FOUND')
  })

  it('returns NO_QR_FOUND for blank png', () => {
    // 1x1 white PNG
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const result = decodeQr({ imageBase64: b64 })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'NO_QR_FOUND')
  })

  it('returns INVALID_INPUT when empty', () => {
    const result = decodeQr({})
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_INPUT')
  })
})
