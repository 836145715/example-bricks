/* eslint-disable */
;(function () {
  const $ = (sel) => document.querySelector(sel)
  const logEl = $('#log')
  const winSessionBody = $('#winSessionBody')
  const scenarioList = $('#scenarioList')
  const meta = $('#meta')

  if (!window.brickly || typeof window.brickly.sendToParent !== 'function') {
    meta.textContent = 'preload 不可用 · window.brickly 缺失'
    return
  }

  meta.textContent = `control · window#${window.brickly.windowId} · ${window.brickly.brickId}`

  const DEFAULT_SCENARIOS = [
    { id: 'standard', label: '标准窗' },
    { id: 'compact', label: '紧凑窗' },
    { id: 'frameless', label: '无边框' },
    { id: 'always-on-top', label: '置顶' },
    { id: 'skip-taskbar', label: '跳过任务栏' },
    { id: 'fixed', label: '固定尺寸' },
    { id: 'transparent', label: '透明底' },
    { id: 'wide', label: '宽屏条' },
    { id: 'tall', label: '竖长条' },
    { id: 'offset', label: '偏移位置' }
  ]

  let scenarios = DEFAULT_SCENARIOS.slice()
  let winSessions = []

  function ts() {
    const d = new Date()
    return (
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0') +
      ':' +
      String(d.getSeconds()).padStart(2, '0')
    )
  }

  function appendLog(level, message) {
    const li = document.createElement('li')
    const cls = level === 'ok' ? 'ok' : level === 'err' ? 'err' : 'info'
    li.innerHTML = `<span class="ts">${ts()}</span><span class="${cls}">${escapeHtml(message)}</span>`
    logEl.prepend(li)
    while (logEl.children.length > 200) logEl.removeChild(logEl.lastChild)
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function selectedMode() {
    const el = document.querySelector('input[name="mode"]:checked')
    return el ? el.value : 'ensure'
  }

  function send(channel, body) {
    window.brickly.sendToParent(channel, body || {})
  }

  function renderScenarios() {
    if (!scenarios.length) {
      scenarioList.innerHTML = '<div class="empty">暂无场景</div>'
      return
    }
    scenarioList.innerHTML = scenarios
      .map(
        (s) => `
      <div class="scenario-item" data-id="${escapeHtml(s.id)}">
        <div>
          <div class="name">${escapeHtml(s.label)}</div>
          <div class="id">${escapeHtml(s.id)}</div>
        </div>
        <button class="btn primary" type="button" data-open="${escapeHtml(s.id)}">打开</button>
      </div>`
      )
      .join('')
  }

  function renderWinSessions() {
    if (!winSessions.length) {
      winSessionBody.innerHTML = '<tr><td colspan="4" class="empty">暂无窗口会话</td></tr>'
      return
    }
    winSessionBody.innerHTML = winSessions
      .map((s) => {
        const roleClass = s.role === 'control' ? 'control' : 'scenario'
        const last = (s.lastEvents || [])
          .slice(-3)
          .map((e) => e.event)
          .join(', ')
        return `
        <tr data-id="${s.windowId}">
          <td>
            <strong>#${s.windowId}</strong><br />
            <span class="id" style="color:#64748b;font-size:11px">${escapeHtml(s.title || '')}</span>
          </td>
          <td>
            <span class="tag ${roleClass}">${escapeHtml(s.role)}</span>
            ${s.scenario ? `<span class="tag">${escapeHtml(s.scenario)}</span>` : ''}
          </td>
          <td>${s.eventCount || 0}<br /><span style="color:#64748b">${escapeHtml(last || '—')}</span></td>
          <td class="ops">
            <button class="btn" type="button" data-act="focus" data-id="${s.windowId}">聚焦</button>
            ${
              s.role === 'scenario'
                ? `<button class="btn" type="button" data-act="ping" data-id="${s.windowId}">Ping</button>
                   <button class="btn" type="button" data-act="bounds" data-id="${s.windowId}">bounds</button>`
                : ''
            }
            <button class="btn danger" type="button" data-act="close" data-id="${s.windowId}">关闭</button>
          </td>
        </tr>`
      })
      .join('')
  }

  window.brickly.on('winSessions', (payload) => {
    winSessions = (payload && payload.winSessions) || []
    renderWinSessions()
  })
  // 兼容旧通道名
  window.brickly.on('sessions', (payload) => {
    winSessions = (payload && (payload.winSessions || payload.sessions)) || []
    renderWinSessions()
  })
  window.brickly.on('scenarios', (payload) => {
    const list = payload && Array.isArray(payload.scenarios) ? payload.scenarios : null
    if (list && list.length) scenarios = list
    renderScenarios()
  })
  window.brickly.on('log', (payload) => {
    if (!payload) return
    appendLog(payload.level || 'info', payload.message || '')
  })
  window.brickly.on('win-session-event', (payload) => {
    if (!payload) return
    const noisy = payload.event === 'move' || payload.event === 'resize'
    if (!noisy) {
      appendLog(
        'info',
        `event #${payload.windowId} · ${payload.event}${payload.detail ? ' · ' + JSON.stringify(payload.detail) : ''}`
      )
    }
    const row = winSessions.find((s) => s.windowId === payload.windowId)
    if (row) {
      row.eventCount = payload.eventCount || (row.eventCount || 0) + 1
      const last = row.lastEvents || []
      last.push({ event: payload.event, at: payload.at })
      row.lastEvents = last.slice(-8)
      renderWinSessions()
    }
  })

  document.body.addEventListener('click', (ev) => {
    const openBtn = ev.target.closest('[data-open]')
    if (openBtn) {
      send('control:open-scenario', {
        scenario: openBtn.getAttribute('data-open'),
        mode: selectedMode()
      })
      return
    }
    const actBtn = ev.target.closest('[data-act]')
    if (actBtn) {
      const id = Number(actBtn.getAttribute('data-id'))
      const act = actBtn.getAttribute('data-act')
      if (act === 'focus') send('control:focus', { windowId: id })
      if (act === 'close') send('control:close', { windowId: id })
      if (act === 'ping') send('control:ping', { windowId: id, text: 'ping-from-control' })
      if (act === 'bounds') send('control:call', { windowId: id, method: 'getBounds', args: [] })
    }
  })

  $('#btnRefresh').onclick = () => send('control:refresh')
  $('#btnClearLog').onclick = () => {
    logEl.innerHTML = ''
  }
  $('#btnSuiteNew').onclick = () => send('control:open-suite', { mode: 'new' })
  $('#btnSuiteEnsure').onclick = () => send('control:open-suite', { mode: 'ensure' })
  $('#btnCloseChildren').onclick = () => send('control:close-all', { keepControl: true })

  renderScenarios()
  send('control:refresh')
  appendLog('ok', 'control ui ready · WinSession 列表见中间栏')
})()
