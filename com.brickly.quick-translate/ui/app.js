/* eslint-disable */
'use strict'

const statusEl = document.getElementById('status')
const sourceEl = document.getElementById('source')
const resultEl = document.getElementById('result')
const errorEl = document.getElementById('error')
const copyButton = document.getElementById('copy')
const closeButton = document.getElementById('close')

let translatedText = ''
let resizeFrame = 0
let lastRequestedHeight = 0

copyButton.addEventListener('click', async () => {
  if (!translatedText) return
  try {
    await navigator.clipboard.writeText(translatedText)
    setStatus('译文已复制')
  } catch (error) {
    showError(`复制失败：${errorMessage(error)}`)
  }
})

closeButton.addEventListener('click', () => {
  window.brickly?.sendToParent?.('quick-translate:close')
})

if (window.brickly?.on) {
  window.brickly.on('translate:start', (payload) => {
    translatedText = ''
    copyButton.disabled = true
    errorEl.hidden = true
    errorEl.textContent = ''
    sourceEl.textContent = textOrFallback(payload?.sourceText, '暂无内容')
    resultEl.textContent = ''
    resultEl.classList.add('streaming')
    setStatus('正在翻译')
    requestPanelResize()
  })

  window.brickly.on('translate:delta', (payload) => {
    const delta = textOrFallback(payload?.delta, '')
    if (!delta) return
    translatedText += delta
    appendStreamingText(delta)
    resultEl.scrollTop = resultEl.scrollHeight
    setStatus('正在输出')
    requestPanelResize()
  })

  window.brickly.on('translate:result', (payload) => {
    translatedText = textOrFallback(payload?.translatedText, '')
    if (resultEl.textContent !== translatedText) {
      resultEl.textContent = translatedText || '未返回译文'
    }
    resultEl.classList.remove('streaming')
    sourceEl.textContent = textOrFallback(payload?.sourceText, sourceEl.textContent)
    copyButton.disabled = !translatedText
    setStatus('翻译完成')
    requestPanelResize()
  })

  window.brickly.on('translate:error', (payload) => {
    sourceEl.textContent = textOrFallback(payload?.sourceText, sourceEl.textContent)
    resultEl.textContent = '翻译失败'
    resultEl.classList.remove('streaming')
    translatedText = ''
    copyButton.disabled = true
    showError(textOrFallback(payload?.error, '未知错误'))
    setStatus('翻译失败')
    requestPanelResize()
  })
} else {
  showError('window.brickly 未加载')
  requestPanelResize()
}

function setStatus(text) {
  statusEl.textContent = text
}

function showError(text) {
  errorEl.hidden = false
  errorEl.textContent = text
}

function textOrFallback(value, fallback) {
  return typeof value === 'string' && value ? value : fallback
}

function appendStreamingText(text) {
  const span = document.createElement('span')
  span.className = 'stream-chunk'
  span.textContent = text
  resultEl.appendChild(span)
}

function requestPanelResize() {
  if (!window.brickly?.sendToParent) return
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    const height = Math.ceil(document.querySelector('.shell').scrollHeight + 18)
    if (Math.abs(height - lastRequestedHeight) < 4) return
    lastRequestedHeight = height
    window.brickly.sendToParent('quick-translate:resize', { height })
  })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
