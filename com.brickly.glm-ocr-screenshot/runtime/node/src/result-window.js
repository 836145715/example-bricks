/* eslint-disable */
'use strict'

const RESULT_WINDOW_URL = 'ui/result.html'
const RENDER_CHANNEL = 'ocr:render'
const READY_CHANNEL = 'ocr:ready'

async function openResultWindow(ctx, payload) {
  const win = await ctx.ui.createBrowserWindow(RESULT_WINDOW_URL, {
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'GLM OCR 标注',
    backgroundColor: '#f6f7f9',
    show: true,
    resizable: true,
    minimizable: true,
    maximizable: true
  })

  const timers = []
  const send = () => sendRenderPayload(win, payload)
  const onMessage = (message) => {
    if (!message || message.channel !== READY_CHANNEL) return
    void send()
  }

  win.on('message', onMessage)
  win.once('closed', () => {
    win.off('message', onMessage)
    for (const timer of timers) clearTimeout(timer)
  })

  await send()
  for (const delay of [250, 1000]) {
    timers.push(setTimeout(() => void send(), delay))
  }

  return win
}

async function sendRenderPayload(win, payload) {
  try {
    await win.webContents.send(RENDER_CHANNEL, payload)
    return true
  } catch {
    return false
  }
}

module.exports = {
  openResultWindow,
  sendRenderPayload,
  RESULT_WINDOW_URL,
  RENDER_CHANNEL
}
