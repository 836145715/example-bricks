'use strict'

const titleEl = document.getElementById('title')
const messageEl = document.getElementById('message')
const intervalEl = document.getElementById('interval')
const countdownEl = document.getElementById('countdown')
const closeBtn = document.getElementById('close')
const bar = document.getElementById('bar')

let timer = null
let closeAt = 0
let totalMs = 0

function closeWindow() {
  window.brickly?.notify?.('close')
}

function startCountdown(seconds) {
  if (timer) clearInterval(timer)
  if (!seconds || seconds <= 0) {
    bar.hidden = true
    countdownEl.textContent = ''
    return
  }
  bar.hidden = false
  totalMs = seconds * 1000
  closeAt = Date.now() + totalMs
  timer = setInterval(() => {
    const remain = Math.max(0, closeAt - Date.now())
    bar.style.setProperty('--progress', `${Math.max(0, Math.min(100, (remain / totalMs) * 100))}%`)
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
  const minutes = Number(payload.intervalMinutes)
  intervalEl.textContent = Number.isFinite(minutes) && minutes > 0 ? `每 ${minutes} 分钟` : ''
  startCountdown(Number(payload.autoCloseSeconds || 0))
}

closeBtn.addEventListener('click', closeWindow)

if (window.brickly && typeof window.brickly.on === 'function') {
  window.brickly.on('show', render)
}
