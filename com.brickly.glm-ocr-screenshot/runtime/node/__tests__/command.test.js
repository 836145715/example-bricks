/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { captureText } = require('../src/command')

test('captureText 框选截图后返回 OCR 文本且默认清理临时截图', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brickly-ocr-test-'))
  const screenshotPath = path.join(outputDir, 'selected.png')
  await fs.writeFile(screenshotPath, 'png')

  const calls = []
  const ctx = {
    isCancelled: () => false,
    progress: (value, message) => calls.push({ type: 'progress', value, message }),
    output: (name, value) => calls.push({ type: 'output', name, value }),
    platform: {
      screenshot: {
        selectRegion: async (input) => {
          calls.push({ type: 'selectRegion', input })
          return { path: screenshotPath }
        }
      }
    },
    invoke: async (brickId, commandId, input) => {
      calls.push({ type: 'invoke', brickId, commandId, input })
      return {
        words_result: [{ words: 'Hello world' }, { words: 'from GLM OCR' }]
      }
    }
  }

  const result = await captureText(ctx, { outputDir, keepScreenshot: false, languageType: 'ENG' })

  assert.equal(result.screenshotPath, '')
  assert.equal(result.wordsText, 'Hello world\nfrom GLM OCR')
  assert.deepEqual(result.wordsResult, [{ words: 'Hello world' }, { words: 'from GLM OCR' }])
  assert.equal(
    calls.find((item) => item.type === 'invoke').brickId,
    'com.brickly.glm-tools'
  )
  assert.equal(calls.find((item) => item.type === 'invoke').commandId, 'ocr')
  assert.equal(calls.find((item) => item.type === 'invoke').input.languageType, 'ENG')
  await assert.rejects(() => fs.stat(screenshotPath), /ENOENT/)
})

