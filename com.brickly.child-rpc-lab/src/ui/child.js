const api = window.brickly
const logEl = document.getElementById('log')
const tickEl = document.getElementById('tick')
const kindEl = document.getElementById('kind')
const identityEl = document.getElementById('identity')
const surfaceEl = document.getElementById('surface')
const hangBtn = document.getElementById('hang')
const cancelHangBtn = document.getElementById('cancelHang')
const importStatusEl = document.getElementById('importStatus')
const selfCheckBtn = document.getElementById('selfCheck')

let hangAbort = null
let lastHello = null
let lastTick = null
let checking = false

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

if (!api || typeof api.request !== 'function') {
  identityEl.textContent = 'preload 未注入'
  surfaceEl.textContent = '没有 window.brickly'
  log('window.brickly 不存在。子窗 preload 没挂上，后面的按钮不会工作。', 'bad')
} else {
  identityEl.textContent = `window ${api.windowId} · ${api.ref.brickId}`
  surfaceEl.textContent = api.getWindowType()

  api.on('hello', (payload) => {
    lastHello = payload
    kindEl.textContent = payload?.kind || 'kind ?'
    log(`hello ${JSON.stringify(payload)}`, 'ok')
  })

  api.on('tick', (payload) => {
    lastTick = payload
    if (payload?.kind) kindEl.textContent = payload.kind
    tickEl.textContent = `tick #${payload?.ticks ?? '?'} · ${payload?.kind ?? ''}`
  })

  document.getElementById('echo').onclick = () =>
    run("request('echo')", () => api.request('echo', { text: document.getElementById('echoText').value }))

  document.getElementById('ping').onclick = () =>
    run("notify('ping')", () => {
      api.notify('ping', { at: Date.now() })
    })

  document.getElementById('importBtn').onclick = () =>
    run("request('import')", async () => {
      const events = []
      importStatusEl.textContent = '进行中…'
      importStatusEl.className = 'status busy'
      try {
        const result = await api.request('import', { file: 'notes.md' }, (event) => {
          events.push(event)
          log(`onEvent ${JSON.stringify(event)}`)
          importStatusEl.textContent = `已收到 ${events.length} 条 onEvent`
        })
        const ok = events.length === 5
        importStatusEl.textContent = ok
          ? `5 条 onEvent 后拿到结果`
          : `只收到 ${events.length} 条 onEvent，应该是 5`
        importStatusEl.className = ok ? 'status ok' : 'status bad'
        return result
      } catch (error) {
        importStatusEl.textContent = formatError(error)
        importStatusEl.className = 'status bad'
        throw error
      }
    })

  hangBtn.onclick = () => {
    hangAbort = new AbortController()
    const requestId = crypto.randomUUID()
    hangAbort.signal.addEventListener('abort', () => api.cancel(requestId), { once: true })
    hangBtn.disabled = true
    cancelHangBtn.disabled = false
    run("request('hang') 不填 timeout", () =>
      api.request('hang', {}, { requestId, signal: hangAbort.signal })
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
      api.request('hang', {}, { timeoutMs: 2000 })
    )

  document.getElementById('missing').onclick = () => run("request('noSuch')", () => api.request('noSuch'))

  document.getElementById('close').onclick = () => {
    log('window.close()')
    void api.window.close()
  }

  selfCheckBtn.onclick = () => {
    void runSelfCheck()
  }

  log('子窗就绪。tick 每秒从 runtime.send 推过来。点「跑自检」可一次过 7 项。')
}

function setCheck(id, state, detail) {
  const el = document.querySelector(`[data-check="${id}"]`)
  if (!el) return
  el.className = state
  const labels = {
    hello: 'hello 推送',
    tick: 'tick 至少 1 次',
    echo: 'echo 有返回值',
    import: 'import 恰好 5 条 onEvent',
    hang: 'hang 点取消得到 CANCELLED',
    timeout: '2 秒 hang 得到 REQUEST_TIMEOUT',
    missing: 'noSuch 得到 NOT_EXPOSED'
  }
  el.textContent = detail ? `${labels[id]} · ${detail}` : labels[id]
}

function waitUntil(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
        return
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        reject(new Error(label))
      }
    }, 50)
  })
}

function errorCode(error) {
  if (!error || typeof error !== 'object') return ''
  if (typeof error.code === 'string' && error.code) return error.code
  const message = [error.message, error.cause?.message, formatError(error)].join(' ')
  const tagged = message.match(/\[([A-Z_]+)\]/)
  if (tagged) return tagged[1]
  if (/CANCELLED|已取消/.test(message)) return 'CANCELLED'
  if (/REQUEST_TIMEOUT|超时/.test(message)) return 'REQUEST_TIMEOUT'
  if (/NOT_EXPOSED|未 expose/.test(message)) return 'NOT_EXPOSED'
  return ''
}

async function runSelfCheck() {
  if (!api || checking) return
  checking = true
  selfCheckBtn.disabled = true
  for (const id of ['hello', 'tick', 'echo', 'import', 'hang', 'timeout', 'missing']) {
    setCheck(id, 'busy')
  }
  log('开始自检')
  try {
    await waitUntil(() => lastHello && lastHello.kind, 2500, '没等到 hello')
    setCheck('hello', 'ok', JSON.stringify(lastHello.kind))
    await waitUntil(() => lastTick && lastTick.ticks >= 1, 2500, '没等到 tick')
    setCheck('tick', 'ok', `#${lastTick.ticks}`)

    const echoed = await api.request('echo', { text: 'self-check' })
    if (!echoed || echoed.echo?.text !== 'self-check') throw new Error('echo 返回值不对')
    setCheck('echo', 'ok')

    const events = []
    const imported = await api.request('import', { file: 'self-check.md' }, (event) => {
      events.push(event)
    })
    if (events.length !== 5 || !imported?.imported) {
      throw new Error(`import 进度 ${events.length} 次`)
    }
    setCheck('import', 'ok', '5')

    const hangId = crypto.randomUUID()
    const hang = api.request('hang', {}, { requestId: hangId })
    await new Promise((resolve) => setTimeout(resolve, 200))
    api.cancel(hangId)
    try {
      await hang
      throw new Error('hang 取消后居然成功了')
    } catch (error) {
      if (errorCode(error) !== 'CANCELLED') throw error
    }
    setCheck('hang', 'ok', 'CANCELLED')

    const timed = Date.now()
    try {
      await api.request('hang', {}, { timeoutMs: 2000 })
      throw new Error('超时 hang 居然成功了')
    } catch (error) {
      if (errorCode(error) !== 'REQUEST_TIMEOUT') throw error
    }
    if (Date.now() - timed < 1500) throw new Error('超时来得太快')
    setCheck('timeout', 'ok', 'REQUEST_TIMEOUT')

    try {
      await api.request('noSuch')
      throw new Error('noSuch 居然成功了')
    } catch (error) {
      if (errorCode(error) !== 'NOT_EXPOSED') throw error
    }
    setCheck('missing', 'ok', 'NOT_EXPOSED')
    log('自检全部通过', 'ok')
  } catch (error) {
    const failed = document.querySelector('#checks li.busy')
    if (failed) {
      const id = failed.getAttribute('data-check')
      setCheck(id, 'bad', formatError(error))
    }
    log(`自检失败 ${formatError(error)}`, 'bad')
  } finally {
    checking = false
    selfCheckBtn.disabled = false
  }
}
