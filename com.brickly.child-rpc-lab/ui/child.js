const brickly = window.brickly
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
    const code = error.code ? `[${error.code}] ` : ''
    return code + (error.message || JSON.stringify(error))
  }
  return String(error)
}

async function run(label, work) {
  log(label)
  try {
    const result = await work()
    if (result !== undefined) log(`${label} → ${JSON.stringify(result)}`, 'ok')
    else log(`${label} 已发出（无返回值）`, 'ok')
  } catch (error) {
    log(`${label} ${formatError(error)}`, 'bad')
  }
}

identityEl.textContent = `window ${brickly.windowId} · ${brickly.ref.brickId}`
surfaceEl.textContent =
  typeof brickly.invoke === 'function' || typeof brickly.start === 'function'
    ? '误拿到体验窗 API'
    : `${brickly.getWindowType()} · 无 invoke/start`

brickly.on('hello', (payload) => {
  kindEl.textContent = payload?.kind || 'kind ?'
  log(`hello ${JSON.stringify(payload)}`, 'ok')
})

brickly.on('tick', (payload) => {
  if (payload?.kind) kindEl.textContent = payload.kind
  tickEl.textContent = `tick #${payload?.ticks ?? '?'} · ${payload?.kind ?? ''}`
})

brickly.on('brickly:closing', () => {
  log('收到 brickly:closing', 'dim')
})

document.getElementById('echo').onclick = () =>
  run('parent.echo', () => brickly.parent.echo({ text: document.getElementById('echoText').value }))

document.getElementById('ping').onclick = () =>
  run("notify('ping')", () => {
    brickly.notify('ping', { at: Date.now() })
  })

document.getElementById('importBtn').onclick = () =>
  run("request('import')", () =>
    brickly.request('import', { file: 'notes.md' }, {
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
    brickly.request('hang', {}, { signal: hangAbort.signal })
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
    brickly.request('hang', {}, { timeoutMs: 2000 })
  )

document.getElementById('missing').onclick = () => run('parent.noSuch', () => brickly.parent.noSuch())

document.getElementById('close').onclick = () => {
  log('window.close()')
  void brickly.window.close()
}

log('子窗就绪。tick 每秒从 runtime.send 推过来。')
