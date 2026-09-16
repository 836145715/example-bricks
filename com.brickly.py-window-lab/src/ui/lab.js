/* eslint-disable */
/**
 * Lab 控制面板前端。
 *
 * 与 runtime 的通信：
 *  - 点按钮 → brickly.request('op', { name, args })
 *  - 点 ⟳ 刷新 → brickly.request('query')
 *  - 返回值直接打日志 / 铺状态表
 *
 * preload 提供的 API：window.brickly.request / on / ref / windowId
 */
;(function () {
  const $ = (sel) => document.querySelector(sel)
  const logEl = $('#log')
  const stateTable = $('#stateTable').querySelector('tbody')
  const stateAt = $('#stateAt')
  const winInfo = $('#winInfo')

  if (!window.brickly || typeof window.brickly.request !== 'function') {
    logEl.innerHTML =
      '<li class="err">window.brickly.request 不可用，无法与 runtime 通信</li>'
    return
  }
  const brickId = window.brickly.ref?.brickId || '?'
  winInfo.textContent = `window#${window.brickly.windowId} · ${brickId}`

  function fmtTime() {
    const d = new Date()
    return (
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0') +
      ':' +
      String(d.getSeconds()).padStart(2, '0') +
      '.' +
      String(d.getMilliseconds()).padStart(3, '0')
    )
  }

  function appendLog(html) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="ts">${fmtTime()}</span>${html}`
    logEl.prepend(li)
    while (logEl.children.length > 200) logEl.removeChild(logEl.lastChild)
  }

  function renderState(payload) {
    if (!payload || !payload.state) return
    const { state, at } = payload
    stateAt.textContent = '@ ' + new Date(at).toLocaleTimeString()
    const rows = Object.entries(state).map(([k, v]) => {
      const isErr = v && typeof v === 'object' && '__error' in v
      const display = isErr
        ? `error: ${v.__error}`
        : v === null
          ? 'null'
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v)
      return `<tr><td>${k}</td><td class="val${isErr ? ' err' : ''}">${display}</td></tr>`
    })
    stateTable.innerHTML = rows.join('') || '<tr><td colspan="2" class="hint">(empty)</td></tr>'
  }

  async function sendOp(name, args) {
    appendLog(`→ <span class="name">${name}</span>(${JSON.stringify(args || [])})`)
    try {
      const payload = await window.brickly.request('op', { name, args: args || [] })
      if (payload?.ok) {
        const r =
          payload.result === null || payload.result === undefined
            ? 'ok'
            : JSON.stringify(payload.result)
        appendLog(`← <span class="ok">✓</span> <span class="name">${name}</span> · ${r}`)
      } else {
        appendLog(
          `← <span class="err">✗</span> <span class="name">${name}</span> · ${payload?.error || 'failed'}`
        )
      }
      if (
        /^(set|min|max|unmax|restore|hide|show|focus|blur|center|moveTop|moveAbove|remove|flash|invalidate|destroy|webContents\.set|webContents\.toggleDevTools|webContents\.close|webContents\.open)/.test(
          name
        )
      ) {
        setTimeout(sendQuery, 80)
      }
    } catch (error) {
      appendLog(
        `← <span class="err">✗</span> <span class="name">${name}</span> · ${error.message || error}`
      )
    }
  }

  async function sendQuery() {
    appendLog('→ <span class="name">query state</span>')
    try {
      renderState(await window.brickly.request('query'))
    } catch (error) {
      appendLog(`← <span class="err">query failed</span> · ${error.message || error}`)
    }
  }

  document.body.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button')
    if (!btn) return

    if (btn.dataset.action === 'query') {
      void sendQuery()
      return
    }

    if (btn.id === 'clearLog') {
      logEl.innerHTML = ''
      return
    }

    const op = btn.dataset.op
    if (!op) return
    let args = []
    if (btn.dataset.args) {
      try {
        args = JSON.parse(btn.dataset.args)
      } catch (e) {
        appendLog(`<span class="err">bad data-args: ${e.message}</span>`)
        return
      }
    }
    void sendOp(op, args)

    if (op === 'hide') setTimeout(() => void sendOp('show', []), 3000)
    if (op === 'setEnabled' && Array.isArray(args) && args[0] === false) {
      setTimeout(() => void sendOp('setEnabled', [true]), 3000)
    }
  })

  setTimeout(() => void sendQuery(), 200)
  appendLog(`<span class="ok">lab ready</span> · windowId=${window.brickly.windowId}`)
})()
