'use strict'
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { resolveOutputPath, ensureUniquePath } = require('../lib/paths')

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

describe('ensureUniquePath', () => {
  /** @type {string} */
  let tmpDir

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'itk-paths-'))
  })

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns path unchanged when file does not exist', async () => {
    const target = path.join(tmpDir, 'fresh.png')
    const result = await ensureUniquePath(target, false)
    assert.equal(result, target)
  })

  it('increments when overwrite is false and file exists', async () => {
    const base = path.join(tmpDir, 'out.png')
    await fs.writeFile(base, 'a')
    const result = await ensureUniquePath(base, false)
    assert.equal(result, path.join(tmpDir, 'out (1).png'))
  })

  it('increments past existing numbered siblings', async () => {
    const base = path.join(tmpDir, 'multi.png')
    await fs.writeFile(base, 'a')
    await fs.writeFile(path.join(tmpDir, 'multi (1).png'), 'b')
    const result = await ensureUniquePath(base, false)
    assert.equal(result, path.join(tmpDir, 'multi (2).png'))
  })

  it('does not increment when overwrite is true', async () => {
    const base = path.join(tmpDir, 'overwrite.png')
    await fs.writeFile(base, 'a')
    const result = await ensureUniquePath(base, true)
    assert.equal(result, base)
  })
})
