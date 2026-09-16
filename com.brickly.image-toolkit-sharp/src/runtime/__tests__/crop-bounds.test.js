'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { clampExtract } = require('../lib/crop-bounds')

describe('clampExtract', () => {
  const img = { imgW: 100, imgH: 80 }

  it('keeps a normal in-bounds rect unchanged', () => {
    assert.deepEqual(
      clampExtract({ x: 10, y: 20, width: 30, height: 40, ...img }),
      { left: 10, top: 20, width: 30, height: 40 }
    )
  })

  it('clamps negative coordinates to 0', () => {
    assert.deepEqual(
      clampExtract({ x: -5, y: -10, width: 20, height: 15, ...img }),
      { left: 0, top: 0, width: 20, height: 15 }
    )
  })

  it('clamps origin past image edge to last pixel', () => {
    assert.deepEqual(
      clampExtract({ x: 200, y: 150, width: 10, height: 10, ...img }),
      { left: 99, top: 79, width: 1, height: 1 }
    )
  })

  it('shrinks width/height that overflow image bounds', () => {
    assert.deepEqual(
      clampExtract({ x: 90, y: 70, width: 50, height: 50, ...img }),
      { left: 90, top: 70, width: 10, height: 10 }
    )
  })

  it('forces zero width/height to at least 1', () => {
    assert.deepEqual(
      clampExtract({ x: 0, y: 0, width: 0, height: 0, ...img }),
      { left: 0, top: 0, width: 1, height: 1 }
    )
  })

  it('forces negative width/height to at least 1', () => {
    assert.deepEqual(
      clampExtract({ x: 5, y: 5, width: -3, height: -2, ...img }),
      { left: 5, top: 5, width: 1, height: 1 }
    )
  })

  it('handles full-image crop', () => {
    assert.deepEqual(
      clampExtract({ x: 0, y: 0, width: 100, height: 80, ...img }),
      { left: 0, top: 0, width: 100, height: 80 }
    )
  })

  it('handles 1x1 image', () => {
    assert.deepEqual(
      clampExtract({ x: 0, y: 0, width: 10, height: 10, imgW: 1, imgH: 1 }),
      { left: 0, top: 0, width: 1, height: 1 }
    )
  })
})
