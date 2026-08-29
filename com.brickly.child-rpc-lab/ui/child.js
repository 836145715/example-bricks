const api = window.brickly
const logEl = document.getElementById('log')
const tickEl = document.getElementById('tick')
const kindEl = document.getElementById('kind')
const identityEl = document.getElementById('identity')
const surfaceEl = document.getElementById('surface')
const hangBtn = document.getElementById('hang')
const cancelHangBtn = document.getElementById('cancelHang')

let hangAbort = null

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

function formatError(error) {
  if (error && typeof error === 'object') {
    let message = error.message || JSON.stringify(error)
    message = message.replace(/^Error invoking remote method '[^']+':\s*/, '')
    message = message.replace(/^BridgeError:\s*/, '')
    const code = error.code ? `[${error.code}] ` : ''
    return code + message
  }
  return String(error)
}

async function run(label, work) {
  log(`点击 ${label}`)
  try {
    const result = await work()
    if (result !== undefined) log(`${label} → ${JSON.stringify(result)}`, 'ok')
    else log(`${label} 已发出（无返回值）`, 'ok')
  } catch (error) {
    log(`${label} ${formatError(error)}`, 'bad')
  }
}

function request(name, payload, options = {}) {
  const requestId =
    typeof options.requestId === 'string' && options.requestId.trim()
      ? options.requestId.trim()
      : crypto.randomUUID()
  const signal = options.signal
  if (signal?.aborted) {
    return Promise.reject(new DOMException('子窗 request 已取消', 'AbortError'))
  }
  const onAbort = () => api.cancel?.(requestId)
  signal?.addEventListener('abort', onAbort, { once: true })
  return api
    .request(name, payload, {
      requestId,
      onEvent: options.onEvent,
      timeoutMs: options.timeoutMs
    })
    .finally(() => signal?.removeEventListener('abort', onAbort))
}

const parent = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== 'string') return undefined
      return (payload) => request(name, payload)
    }
  }
)

if (!api || typeof api.request !== 'function') {
  identityEl.textContent = 'preload 未注入'
  surfaceEl.textContent = '没有 window.brickly'
  log('window.brickly 不存在。子窗 preload 没挂上，后面的按钮不会工作。', 'bad')
} else {
  identityEl.textContent = `window ${api.windowId} · ${api.ref.brickId}`
  surfaceEl.textContent =
    typeof api.invoke === 'function' || typeof api.start === 'function'
      ? '误拿到体验窗 API'
      : `${api.getWindowType()} · 无 invoke/start`

  api.on('hello', (payload) => {
    kindEl.textContent = payload?.kind || 'kind ?'
    log(`hello ${JSON.stringify(payload)}`, 'ok')
  })

  api.on('tick', (payload) => {
    if (payload?.kind) kindEl.textContent = payload.kind
    tickEl.textContent = `tick #${payload?.ticks ?? '?'} · ${payload?.kind ?? ''}`
  })

  api.on('brickly:closing', () => {
    log('收到 brickly:closing', 'dim')
  })

  document.getElementById('echo').onclick = () =>
    run('parent.echo', () => parent.echo({ text: document.getElementById('echoText').value }))

  document.getElementById('ping').onclick = () =>
    run("notify('ping')", () => {
      api.notify('ping', { at: Date.now() })
    })

  document.getElementById('importBtn').onclick = () =>
    run("request('import')", () =>
      request('import', { file: 'notes.md' }, {
        onEvent(event) {
          log(`onEvent ${JSON.stringify(event)}`)
        }
      })
    )

  hangBtn.onclick = () => {
    hangAbort = new AbortController()
    hangBtn.disabled = true
    cancelHangBtn.disabled = false
    run("request('hang') 不填 timeout", () =>
      request('hang', {}, { signal: hangAbort.signal })
    ).finally(() => {
      hangBtn.disabled = false
      cancelHangBtn.disabled = true
      hangAbort = null
    })
  }

  cancelHangBtn.onclick = () => {
    hangAbort?.abort()
    log('signal.abort()', 'dim')
  }

  document.getElementById('timeout').onclick = () =>
    run("request('hang', { timeoutMs: 2000 })", () =>
      request('hang', {}, { timeoutMs: 2000 })
    )

  document.getElementById('missing').onclick = () => run('parent.noSuch', () => parent.noSuch())

  document.getElementById('close').onclick = () => {
    log('window.close()')
    void api.window.close()
  }

  log('子窗就绪。tick 每秒从 runtime.send 推过来。')
}
