/* eslint-disable */
'use strict'

const titleEl = document.getElementById('title')
const messageEl = document.getElementById('message')
const timeEl = document.getElementById('time')
const countdownEl = document.getElementById('countdown')
const closeBtn = document.getElementById('close')
const bar = document.getElementById('bar')

let timer = null
let closeAt = 0
let totalMs = 0

function closeWindow() {
  if (window.brickly && typeof window.brickly.sendToParent === 'function') {
    window.brickly.sendToParent('reminder:close')
  }
}

function startCountdown(seconds) {
  if (timer) clearInterval(timer)
  if (!seconds || seconds <= 0) {
    bar.style.setProperty('--progress', '100%')
    countdownEl.textContent = ''
    return
  }
  totalMs = seconds * 1000
  closeAt = Date.now() + totalMs
  timer = setInterval(() => {
    const remain = Math.max(0, closeAt - Date.now())
    const pct = Math.max(0, Math.min(100, (remain / totalMs) * 100))
    bar.style.setProperty('--progress', `${pct}%`)
    countdownEl.textContent = `${Math.ceil(remain / 1000)} 秒后关闭`
    if (remain <= 0) {
      clearInterval(timer)
      closeWindow()
    }
  }, 200)
}

function render(payload) {
  titleEl.textContent = payload.title || '提醒'
  messageEl.textContent = payload.message || '该处理这件事了。'
  timeEl.textContent = new Date(payload.firedAt || Date.now()).toLocaleString()
  startCountdown(Number(payload.autoCloseSeconds || 0))
}

closeBtn.addEventListener('click', closeWindow)

if (window.brickly && typeof window.brickly.on === 'function') {
  window.brickly.on('reminder:show', render)
}
