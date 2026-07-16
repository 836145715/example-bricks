'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { resolveOutputPath } = require('../lib/paths')

describe('resolveOutputPath', () => {
  it('sidecar default', () => {
    const p = resolveOutputPath({
      inputPath: 'D:\\pics\\a.jpg',
      action: 'compress',
      options: {},
      output: { mode: 'sidecar' }
    })
    assert.equal(path.basename(p), 'a_compress_processed.jpg')
  })

  it('convert uses target ext', () => {
    const p = resolveOutputPath({
      inputPath: 'D:\\pics\\a.jpg',
      action: 'convert',
      options: { format: 'webp' },
      output: { mode: 'sidecar' }
    })
    assert.equal(path.basename(p), 'a_convert_processed.webp')
  })

  it('dir mode', () => {
    const p = resolveOutputPath({
      inputPath: 'D:\\pics\\a.jpg',
      action: 'compress',
      options: {},
      output: { mode: 'dir', dir: 'D:\\out' }
    })
    assert.equal(p, path.join('D:\\out', 'a_compress_processed.jpg'))
  })

  it('dir mode without dir throws TypeError', () => {
    assert.throws(
      () => resolveOutputPath({
        inputPath: 'D:\\pics\\a.jpg',
        action: 'compress',
        options: {},
        output: { mode: 'dir' }
      }),
      (err) => {
        assert.ok(err instanceof TypeError)
        assert.match(err.message, /output\.dir/i)
        return true
      }
    )
  })

  it('dir mode with empty dir throws TypeError', () => {
    assert.throws(
      () => resolveOutputPath({
        inputPath: 'D:\\pics\\a.jpg',
        action: 'compress',
        options: {},
        output: { mode: 'dir', dir: '' }
      }),
      (err) => {
        assert.ok(err instanceof TypeError)
        assert.match(err.message, /output\.dir/i)
        return true
      }
    )
  })

  it('rejects format with path traversal', () => {
    assert.throws(
      () => resolveOutputPath({
        inputPath: 'D:\\pics\\a.jpg',
        action: 'convert',
        options: { format: '../webp' },
        output: { mode: 'sidecar' }
      }),
      (err) => {
        assert.match(err.message, /format/i)
        return true
      }
    )
  })

  it('rejects format with illegal characters', () => {
    assert.throws(
      () => resolveOutputPath({
        inputPath: 'D:\\pics\\a.jpg',
        action: 'convert',
        options: { format: 'webp;rm' },
        output: { mode: 'sidecar' }
      }),
      (err) => {
        assert.match(err.message, /format/i)
        return true
      }
    )
  })

  it('rejects action with path separators', () => {
    assert.throws(
      () => resolveOutputPath({
        inputPath: 'D:\\pics\\a.jpg',
        action: '../evil',
        options: {},
        output: { mode: 'sidecar' }
      }),
      (err) => {
        assert.match(err.message, /action/i)
        return true
      }
    )
  })

  it('normalizes format leading dots and case', () => {
    const p = resolveOutputPath({
      inputPath: 'D:\\pics\\a.jpg',
      action: 'convert',
      options: { format: '.WEBP' },
      output: { mode: 'sidecar' }
    })
    assert.equal(path.basename(p), 'a_convert_processed.webp')
  })

  it('pdf action uses .pdf extension', () => {
    const p = resolveOutputPath({
      inputPath: 'D:\\pics\\a.jpg',
      action: 'pdf',
      options: {},
      output: { mode: 'sidecar' }
    })
    assert.equal(path.basename(p), 'a_pdf_processed.pdf')
  })

  it('gif action uses .gif extension', () => {
    const p = resolveOutputPath({
      inputPath: 'D:\\pics\\a.jpg',
      action: 'gif',
      options: {},
      output: { mode: 'sidecar' }
    })
    assert.equal(path.basename(p), 'a_gif_processed.gif')
  })
})
