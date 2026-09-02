let handle = null
let session = null
let opening = false
const remaining = document.getElementById('remaining')
const seconds = document.getElementById('seconds')
const error = document.getElementById('error')

async function ensureHandle() {
  if (!handle) handle = await window.brickly.start()
  return handle
}

function releaseHandle() {
  const runtime = handle
  handle = null
  if (runtime) void runtime.dispose().catch(() => {})
}

function clearSession(current) {
  if (session !== current) return
  session = null
  if (!opening) releaseHandle()
}

async function open(commandId) {
  opening = true
  try {
    error.textContent = ''
    if (session) {
      const previous = session
      try {
        previous.cancel()
      } catch {
        // 上一局可能已经结束
      }
      await previous.end().catch(() => {})
      clearSession(previous)
    }
    const runtime = await ensureHandle()
    const value = Number(seconds.value) || 60
    remaining.textContent = String(value)
    session = await runtime.interact(commandId, { seconds: value }, {
      onEvent(event) {
        if (event && event.type === 'tick') remaining.textContent = String(event.remaining ?? 0)
      }
    })
  } catch (err) {
    error.textContent = err.message || String(err)
  } finally {
    opening = false
    if (!session) releaseHandle()
  }
}

async function control(type) {
  if (!session) {
    error.textContent = '先打开倒计时，再暂停 / 继续 / 重置'
    return
  }
  try {
    error.textContent = ''
    await session.send({ type })
  } catch (err) {
    error.textContent = err.message || String(err)
  }
}

document.getElementById('open').onclick = () => open('timer')
document.getElementById('pin').onclick = () => open('pin')
document.getElementById('pause').onclick = () => control('pause')
document.getElementById('resume').onclick = () => control('resume')
document.getElementById('reset').onclick = () => control('reset')
