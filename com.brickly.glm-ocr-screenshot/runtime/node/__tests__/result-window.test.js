/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { openResultWindow, RENDER_CHANNEL } = require('../src/result-window')

test('openResultWindow 在窗口 ready 回调中保留 command requestId', async () => {
  const sent = []
  const handlers = new Map()
  const win = {
    webContents: {
      send: async (channel, payload) => {
        sent.push({ channel, payload })
        return true
      }
    },
    on: (event, handler) => handlers.set(event, handler),
    once: (event, handler) => handlers.set(`once:${event}`, handler),
    off: (event) => handlers.delete(event)
  }
  const ctx = {
    requestId: 'cmd-ocr-render',
    ui: {
      createBrowserWindow: async () => win
    }
  }

  const payload = {
    generatedAt: 1,
    screenshot: { dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 },
    ocr: { wordsText: 'hello', wordsResult: [], wordsResultNum: 0 },
    options: { languageType: 'AUTO', probability: false }
  }

  await openResultWindow(ctx, payload)
  handlers.get('message')({ channel: 'ocr:ready' })

  const renderMessages = sent.filter((item) => item.channel === RENDER_CHANNEL)
  assert.equal(renderMessages.length, 2)
  assert.equal(renderMessages[0].payload.requestId, 'cmd-ocr-render')
  assert.equal(renderMessages[1].payload.requestId, 'cmd-ocr-render')
})
