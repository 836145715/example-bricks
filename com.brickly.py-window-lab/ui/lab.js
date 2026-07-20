/* eslint-disable */
/**
 * Lab 控制面板前端。
 *
 * 与 runtime 的通信：
 *  - 点按钮 → brickly.sendToParent('lab:op', { reqId, name, args })
 *  - brickly.on('lab:result', { reqId, name, ok, result, error }) 接收回包并打日志
 *  - 点 ⟳ 刷新 → brickly.sendToParent('lab:query', { reqId })
 *  - brickly.on('lab:state', { state }) 接收 30+ 个 is* / get* 调用的结果字典并铺到状态表
 *
 * preload 提供的 API：window.brickly.sendToParent / on / brickId / windowId
 */
;(function () {
  const $ = (sel) => document.querySelector(sel)
  const logEl = $('#log')
  const stateTable = $('#stateTable').querySelector('tbody')
  const stateAt = $('#stateAt')
  const winInfo = $('#winInfo')

  if (!window.brickly || typeof window.brickly.sendToParent !== 'function') {
    logEl.innerHTML =
      '<li class="err">window.brickly preload 不可用，无法与 runtime 通信</li>'
    if (winInfo) {
      winInfo.textContent = 'preload 不可用'
      winInfo.style.color = '#f87171'
    }
    document.body.style.outline = '3px solid #f87171'
    return
  }
  winInfo.textContent = `window#${window.brickly.windowId} · ${window.brickly.brickId}`

  let seq = 0
  function nextId(prefix) {
    seq += 1
    return `${prefix}-${seq}-${Date.now().toString(36)}`
  }

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

  if (!window.brickly.windowId) {
    appendLog(
      '<span class="err">windowId=0：子窗口身份 identify 失败，sendToParent 可能被宿主丢弃</span>'
    )
  }

  const pendingTimers = new Map()

  function armTimeout(reqId, label) {
    clearTimeout(pendingTimers.get(reqId))
    const timer = setTimeout(() => {
      pendingTimers.delete(reqId)
      appendLog(
        `<span class="err">⏱ 无回包</span> <span class="name">${label}</span> · runtime 未在 3s 内回复 lab:result/lab:state（看 .lab-debug.log）`
      )
    }, 3000)
    pendingTimers.set(reqId, timer)
  }

  function clearPending(reqId) {
    const timer = pendingTimers.get(reqId)
    if (timer) clearTimeout(timer)
    pendingTimers.delete(reqId)
  }

  function sendOp(name, args) {
    const reqId = nextId('op')
    window.brickly.sendToParent('lab:op', { reqId, name, args: args || [] })
    appendLog(
      `→ <span class="name">${name}</span>(${JSON.stringify(args || [])})`
    )
    armTimeout(reqId, name)
    return reqId
  }

  function sendQuery() {
    const reqId = nextId('q')
    window.brickly.sendToParent('lab:query', { reqId })
    appendLog('→ <span class="name">query state</span>')
    armTimeout(reqId, 'query state')
  }

  // —— 接收 runtime 回包 ——
  window.brickly.on('lab:result', (payload) => {
    if (!payload) return
    if (payload.reqId) clearPending(payload.reqId)
    const { name, ok, result, error } = payload
    if (ok) {
      const r = result === null || result === undefined ? 'ok' : JSON.stringify(result)
      appendLog(`← <span class="ok">✓</span> <span class="name">${name}</span> · ${r}`)
    } else {
      appendLog(`← <span class="err">✗</span> <span class="name">${name}</span> · ${error}`)
    }
    // 大多数操作后自动刷一次状态
    if (/^(set|min|max|unmax|restore|hide|show|focus|blur|center|moveTop|moveAbove|remove|flash|invalidate|destroy|webContents\.set|webContents\.toggleDevTools|webContents\.close|webContents\.open)/.test(
      name
    )) {
      setTimeout(sendQuery, 80)
    }
  })

  window.brickly.on('lab:state', (payload) => {
    if (!payload || !payload.state) return
    if (payload.reqId) clearPending(payload.reqId)
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
  })

  // —— 点击事件绑定 ——
  document.body.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button')
    if (!btn) return

    if (btn.dataset.action === 'query') {
      sendQuery()
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
    sendOp(op, args)

    // 几个"破坏性"操作做自动恢复，避免被锁死
    if (op === 'hide') setTimeout(() => sendOp('show', []), 3000)
    if (op === 'setEnabled' && Array.isArray(args) && args[0] === false) {
      setTimeout(() => sendOp('setEnabled', [true]), 3000)
    }
  })

  // 启动时先拉一次状态
  setTimeout(sendQuery, 200)
  appendLog(`<span class="ok">lab ready</span> · windowId=${window.brickly.windowId}`)
})()
