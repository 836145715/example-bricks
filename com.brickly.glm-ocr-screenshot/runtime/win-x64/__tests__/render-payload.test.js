/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  buildOcrRenderPayload,
  extractWordsText,
  readPngSizeFromBuffer
} = require('../src/render-payload')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzL0ygAAAABJRU5ErkJggg==',
  'base64'
)

test('readPngSizeFromBuffer 读取 PNG 尺寸', () => {
  assert.deepEqual(readPngSizeFromBuffer(PNG_1X1), { width: 1, height: 1 })
})

test('extractWordsText 拼接 OCR 文本', () => {
  assert.equal(extractWordsText([{ words: '你好' }, { words: '' }, { words: '世界' }]), '你好\n世界')
})

test('buildOcrRenderPayload 生成 H5 渲染所需数据', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glm-ocr-render-payload-'))
  const screenshotPath = path.join(dir, 'shot.png')
  await fs.writeFile(screenshotPath, PNG_1X1)
  try {
    const payload = await buildOcrRenderPayload({
      screenshotPath,
      wordsResult: [
        {
          words: 'hello',
          location: { left: 0, top: 0, width: 1, height: 1 },
          probability: { average: 0.98 }
        }
      ],
      ocrResponse: { status: 'succeeded', message: '成功', task_id: 'task-1' },
      languageType: 'AUTO',
      probability: true
    })

    assert.equal(payload.screenshot.width, 1)
    assert.equal(payload.screenshot.height, 1)
    assert.match(payload.screenshot.dataUrl, /^data:image\/png;base64,/)
    assert.equal(payload.ocr.wordsText, 'hello')
    assert.equal(payload.ocr.wordsResultNum, 1)
    assert.equal(payload.options.probability, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
