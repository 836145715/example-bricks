/* eslint-disable */
'use strict'

const statusEl = document.getElementById('status')
const gridEl = document.getElementById('grid')
const minBtn = document.getElementById('min')
const maxBtn = document.getElementById('max')
const closeBtn = document.getElementById('close')

/** @type {import('@syllm/brickly-ui').BricklyStartedHandle | null} */
let started = null

const SCENES = [
  {
    id: 'page-log',
    lane: '顶级',
    title: '页面 window.brickly.log',
    expect: '左侧多一条宿主/页面诊断，不进任何 command 节点。',
    run: async () => {
      if (!window.brickly?.log) throw new Error('window.brickly.log 不可用')
      window.brickly.log.info('log-lab 页面日志', { from: 'ui' })
      return { ok: true }
    }
  },
  {
    id: 'log-levels',
    lane: '节点日志',
    title: '命令内 brick.log / ctx.log',
    expect: '点开本节点 → 日志栏有 info/warn；左侧不应再占一行同样正文。',
    run: () => api().invoke('log-levels', { text: 'hello log-lab' })
  },
  {
    id: 'debug',
    lane: '节点日志',
    title: 'Debug 默认隐藏',
    expect: '节点日志里有 debug。左侧默认 Info+，把最低级别调到 Debug 才看见。',
    run: () => api().invoke('log-levels', { text: 'debug-check' })
  },
  {
    id: 'log-error-keep-success',
    lane: '不要搞混',
    title: 'log.error 但命令成功',
    expect: '节点 status=成功；日志栏有一条 error。不要再出现第二条失败调用。',
    run: () => api().invoke('log-error-keep-success', {})
  },
  {
    id: 'fail-after-log',
    lane: '不要搞混',
    title: '打日志后失败',
    expect: '节点 status=失败；warn 在日志栏。不要把失败再复制成一条顶级失败日志。',
    run: async () => {
      try {
        return await api().invoke('fail-after-log', {})
      } catch (error) {
        return { failed: true, message: errorMessage(error) }
      }
    }
  },
  {
    id: 'stream-frames',
    lane: '节点事件',
    title: '流式帧',
    expect: '点开节点 → 事件栏有 progress 帧；日志栏只有「开始推流式帧」。',
    run: async () => {
      const frames = []
      const result = await api().call('stream-frames', { count: 3 }, {
        onEvent: (event) => {
          frames.push(event)
        }
      })
      return { result, frames }
    }
  },
  {
    id: 'chat',
    lane: '节点事件',
    title: 'interact 来回帧',
    expect: '一条 interact 会话节点；事件栏有 input/output 帧；日志栏有「interact 已打开」。',
    run: async () => {
      const frames = []
      const session = await api().interact('chat', { prompt: 'ping' }, {
        onEvent: (event) => {
          frames.push(event)
        }
      })
      await session.send({ type: 'user', text: 'ping' })
      const result = await session.end()
      return { result, frames }
    }
  },
  {
    id: 'publish-in-command',
    lane: '节点事件',
    title: '命令内 publish',
    expect: '若总线记到本命令：事件栏有 published。不应再为这次 publish 另开顶级操作。',
    run: () => api().invoke('publish-in-command', {})
  },
  {
    id: 'schedule-idle-log',
    lane: '顶级',
    title: '命令结束后的工具日志',
    expect: '先出现 command 节点；约 1.2s 后再多一条顶级「idle brick.log after command」。',
    run: () => api().invoke('schedule-idle-log', { delayMs: 1200 })
  },
  {
    id: 'stdout-in-command',
    lane: '节点日志',
    title: '命令内裸 stdout',
    expect: '恰好一条未收口命令时，stdout 挂本节点日志，并带 deprecated。',
    run: () => api().invoke('stdout-in-command', {})
  },
  {
    id: 'schedule-stdout',
    lane: '顶级',
    title: '命令结束后的裸 stdout',
    expect: '约 1.2s 后左侧多一条工具顶级错误日志（deprecated stdout）。',
    run: () => api().invoke('schedule-stdout', { delayMs: 1200 })
  },
  {
    id: 'call-child',
    lane: '子节点',
    title: '调用子工具',
    expect: '画布上父节点 + 子节点。子 Brick 的日志只在子节点日志栏。',
    run: () => api().invoke('call-child', { text: 'hello from parent' })
  }
]

function api() {
  if (started) return started
  if (!window.brickly) throw new Error('请在 Brickly 里打开本工具')
  return window.brickly
}

function errorMessage(error) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  return error.message || String(error)
}

function setStatus(text) {
  statusEl.textContent = text
}

function render() {
  gridEl.replaceChildren(
    ...SCENES.map((scene) => {
      const card = document.createElement('article')
      card.className = 'card'
      card.innerHTML = `
        <div class="meta"><span class="lane">${scene.lane}</span><span>${scene.id}</span></div>
        <h2>${scene.title}</h2>
        <p>${scene.expect}</p>
        <button type="button">运行</button>
        <div class="out" hidden></div>
      `
      const button = card.querySelector('button')
      const out = card.querySelector('.out')
      button.addEventListener('click', async () => {
        button.disabled = true
        out.hidden = false
        out.classList.remove('err')
        out.textContent = '运行中…'
        try {
          await ensureStarted()
          const result = await scene.run()
          out.textContent = JSON.stringify(result, null, 2)
          setStatus(`完成 ${scene.id} · 去日志中心对照`)
        } catch (error) {
          out.classList.add('err')
          out.textContent = errorMessage(error)
          setStatus(`失败 ${scene.id}`)
        } finally {
          button.disabled = false
        }
      })
      return card
    })
  )
}

async function ensureStarted() {
  if (started) return started
  if (!window.brickly?.start) throw new Error('window.brickly.start 不可用')
  started = await window.brickly.start()
  setStatus('运行时已连接 · 打开日志中心看「log-lab ready」')
  return started
}

function bindWindowControls() {
  const win = window.brickly?.window
  minBtn.addEventListener('click', () => win?.minimize?.())
  maxBtn.addEventListener('click', () => win?.toggleMaximize?.())
  closeBtn.addEventListener('click', () => {
    if (win?.close) win.close()
    else window.brickly?.closeWindow?.()
  })
}

bindWindowControls()
render()
setStatus(window.brickly ? '就绪 · 先打开侧栏「日志中心」' : '未注入 window.brickly')
if (window.brickly?.start) {
  ensureStarted().catch((error) => setStatus(errorMessage(error)))
}
