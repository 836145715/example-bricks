/* eslint-disable */
;(function () {
  const meta = document.getElementById('meta')
  const title = document.getElementById('title')
  const logEl = document.getElementById('log')

  if (!window.brickly || typeof window.brickly.sendToParent !== 'function') {
    meta.textContent = 'preload 不可用'
    return
  }

  let info = {
    windowId: window.brickly.windowId,
    brickId: window.brickly.brickId
  }

  function line(msg) {
    const div = document.createElement('div')
    div.textContent = msg
    logEl.prepend(div)
    while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild)
  }

  function render() {
    title.textContent = info.title || info.scenario || 'Scenario Child'
    meta.textContent = [
      `window#${info.windowId}`,
      info.scenario ? `scenario=${info.scenario}` : null,
      info.role ? `role=${info.role}` : null,
      info.brickId
    ]
      .filter(Boolean)
      .join(' · ')
  }

  window.brickly.on('child:hello', (payload) => {
    info = { ...info, ...(payload || {}) }
    render()
    line(`hello from runtime: ${JSON.stringify(payload || {})}`)
  })

  window.brickly.on('child:ping', (payload) => {
    line(`ping ← ${JSON.stringify(payload || {})}`)
    window.brickly.sendToParent('child:pong', {
      reqId: payload && payload.reqId,
      text: `pong:${(payload && payload.text) || ''}`
    })
  })

  document.getElementById('btnPingParent').onclick = () => {
    window.brickly.sendToParent('child:log', {
      message: `hi from #${window.brickly.windowId} at ${new Date().toLocaleTimeString()}`
    })
    line('sent child:log to parent')
  }
  document.getElementById('btnHello').onclick = () => {
    window.brickly.sendToParent('child:ready', {})
    line('sent child:ready')
  }
  document.getElementById('btnClose').onclick = () => {
    window.brickly.sendToParent('child:close-self', {})
  }

  render()
  window.brickly.sendToParent('child:ready', {})
  line('child ready · events bound on WindowHandle in runtime')
})()
