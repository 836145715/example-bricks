const statusEl = document.getElementById('status')
const logEl = document.getElementById('log')
const attachedBtn = document.getElementById('attached')
const standaloneBtn = document.getElementById('standalone')

let handle = null
let starting = null

function stamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function log(message, kind = 'dim') {
  const line = document.createElement('div')
  line.className = kind
  line.textContent = `${stamp()}  ${message}`
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
}

function setStatus(text, kind = '') {
  statusEl.className = `status ${kind}`.trim()
  statusEl.textContent = text
}

function formatError(error) {
  if (error && typeof error === 'object') {
    const code = error.code ? `[${error.code}] ` : ''
    return code + (error.message || JSON.stringify(error))
  }
  return String(error)
}

async function ensureHandle() {
  if (handle) return handle
  if (!starting) {
    starting = window.brickly
      .start()
      .then((started) => {
        handle = started
        log('runtime started', 'ok')
        return started
      })
      .catch((error) => {
        starting = null
        throw error
      })
  }
  return starting
}

async function openWindow(commandId) {
  const started = Date.now()
  setStatus(`${commandId} 进行中…`, 'busy')
  log(`invoke ${commandId}`)
  try {
    const runtime = await ensureHandle()
    const result = await runtime.invoke(commandId, {})
    const ms = Date.now() - started
    setStatus(`${commandId} 已返回（${ms}ms）`, 'ok')
    log(`${commandId} 返回 ${JSON.stringify(result)}  用时 ${ms}ms`, 'ok')
  } catch (error) {
    setStatus(`${commandId} 失败`, 'bad')
    log(`${commandId} ${formatError(error)}`, 'bad')
  }
}

attachedBtn.onclick = () => openWindow('open-attached')
standaloneBtn.onclick = () => openWindow('open-standalone')

ensureHandle()
  .then(() => setStatus('runtime 已就绪，可以开窗', 'ok'))
  .catch((error) => {
    setStatus('start 失败', 'bad')
    log(formatError(error), 'bad')
  })
