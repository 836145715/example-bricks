/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { normalizeCaptureInput } = require('../src/input')

test('normalizeCaptureInput 提供默认值', () => {
  const input = normalizeCaptureInput({})
  assert.equal(input.languageType, 'AUTO')
  assert.equal(input.probability, false)
  assert.equal(input.keepScreenshot, false)
  assert.equal(input.outputDir, path.join(os.tmpdir(), 'brickly-glm-ocr-screenshot'))
})

test('normalizeCaptureInput 校验语言类型', () => {
  assert.throws(() => normalizeCaptureInput({ languageType: 'NOPE' }), /languageType/)
})
