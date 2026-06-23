/* eslint-disable */
'use strict'

const image = document.getElementById('overlay')

if (window.brickly?.on) {
  window.brickly.on('quick-translate-overlay:render', (payload) => {
    if (!payload || typeof payload.imagePath !== 'string') return
    image.src = `file:///${payload.imagePath.replace(/\\/g, '/')}`
  })
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  window.brickly?.sendToParent?.('quick-translate-overlay:close')
})

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.brickly?.sendToParent?.('quick-translate-overlay:close')
})

window.brickly?.sendToParent?.('quick-translate-overlay:ready')
