/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { openResultWindow, RENDER_CHANNEL, READY_CHANNEL } = require('../src/result-window')

test('openResultWindow 在窗口 ready 后重发相同渲染 payload', async () => {
  const sent = []
  const exposed = {}
  const win = {
    send: async (channel, payload) => {
      sent.push({ channel, payload })
      return true
    },
    expose: (methods) => Object.assign(exposed, methods),
    once: () => {}
  }
  const ui = {
    createBrowserWindow: async () => win
  }

  const payload = {
    generatedAt: 1,
    screenshot: { dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 },
    ocr: { wordsText: 'hello', wordsResult: [], wordsResultNum: 0 },
    options: { languageType: 'AUTO', probability: false }
  }

  await openResultWindow(ui, payload)
  exposed[READY_CHANNEL]()

  const renderMessages = sent.filter((item) => item.channel === RENDER_CHANNEL)
  assert.equal(renderMessages.length, 2)
  assert.deepEqual(renderMessages[0].payload, payload)
  assert.deepEqual(renderMessages[1].payload, payload)
})
