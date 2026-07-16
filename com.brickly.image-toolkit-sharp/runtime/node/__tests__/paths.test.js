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
})
