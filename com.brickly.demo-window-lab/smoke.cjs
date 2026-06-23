/* eslint-disable */
/**
 * 临时冒烟测试：模拟宿主与 lab runtime 交互。
 *  1. 发 host.hello → 期待 runtime.ready
 *  2. runtime ready 后应自动调 host.ui.createBrowserWindow
 *  3. 模拟子窗口 sendToParent('lab:op', { name:'maximize' }) → 期待 host.ui.callWindow(maximize)
 *     + 期待 host.ui.callWindow(webContents.send, 'lab:result', ...) 回包
 *  4. 模拟 lab:query → 期待 N 次 callWindow（is* / getXxx）并 webContents.send('lab:state', ...)
 *  5. 关掉
 */
const { spawn } = require('child_process')
const path = require('path')

const child = spawn(process.execPath, [path.resolve(__dirname, 'runtime/node/index.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
})

let buf = ''
const observed = []
const winId = 7777

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n')
}

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buf += chunk
  const lines = buf.split(/\r?\n/)
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    observed.push(msg.type + (msg.method ? `(${msg.method})` : ''))
    console.log(
      '<<',
      msg.type,
      msg.method ? `· ${msg.method}` : '',
      msg.id ? `id=${msg.id}` : ''
    )

    // 自动回应 host.* 请求
    if (msg.type === 'host.ui.createBrowserWindow') {
      send({ type: 'host.result', id: msg.id, result: { windowId: winId } })
    } else if (msg.type === 'host.ui.callWindow') {
      // 给 query 系列伪造一些返回值
      const m = msg.method
      let fake = null
      if (m === 'getBounds' || m === 'getContentBounds' || m === 'getNormalBounds')
        fake = { x: 100, y: 100, width: 980, height: 720 }
      else if (m === 'getPosition') fake = [100, 100]
      else if (m === 'getSize' || m === 'getContentSize') fake = [980, 720]
      else if (m === 'getMinimumSize') fake = [0, 0]
      else if (m === 'getMaximumSize') fake = [0, 0]
      else if (m === 'getOpacity') fake = 1
      else if (m === 'getTitle') fake = 'Brickly Lab'
      else if (m && m.startsWith('is')) fake = m === 'isVisible' || m === 'isFocusable' || m === 'isNormal'
      else if (m === 'hasShadow') fake = true
      else if (m === 'webContents.getURL') fake = 'file:///lab.html'
      else if (m === 'webContents.getTitle') fake = 'Brickly Lab'
      else if (m === 'webContents.getZoomFactor') fake = 1
      else if (m === 'webContents.getZoomLevel') fake = 0
      else if (m === 'webContents.isDevToolsOpened' || m === 'webContents.canGoBack' || m === 'webContents.canGoForward') fake = false
      send({ type: 'host.result', id: msg.id, result: fake })
    } else if (msg.type === 'host.ui.closeWindow') {
      send({ type: 'host.result', id: msg.id, result: null })
    }
  }
})

child.stderr.setEncoding('utf8')
child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d))

// 1. 握手
send({ type: 'host.hello', protocolVersion: '0.1.0' })

// 2. 600ms 后模拟子窗口发 lab:op maximize
setTimeout(() => {
  send({
    type: 'event.notify',
    event: 'window.message',
    payload: {
      windowId: winId,
      channel: 'lab:op',
      args: [{ reqId: 'u1', name: 'maximize', args: [] }]
    }
  })
}, 700)

// 3. 1200ms 后模拟 lab:query
setTimeout(() => {
  send({
    type: 'event.notify',
    event: 'window.message',
    payload: {
      windowId: winId,
      channel: 'lab:query',
      args: [{ reqId: 'q1' }]
    }
  })
}, 1200)

// 4. 2.5s 后 shutdown
setTimeout(() => {
  send({ type: 'runtime.shutdown' })
}, 2500)

child.on('exit', (code) => {
  console.log('child exited code=', code)
  const callWindowMethods = observed
    .filter((t) => t.startsWith('host.ui.callWindow'))
    .map((t) => t.match(/\((.+)\)/)?.[1])
  const required = ['runtime.ready', 'host.ui.createBrowserWindow', 'runtime.bye']
  for (const t of required) {
    if (!observed.some((x) => x.startsWith(t))) {
      console.error('MISSING', t)
      process.exit(1)
    }
  }
  // 至少应观察到 maximize 与若干 query 调用
  if (!callWindowMethods.includes('maximize')) {
    console.error('未观察到 maximize 调用，callWindow=', callWindowMethods)
    process.exit(1)
  }
  const queryCalls = callWindowMethods.filter((m) => /^(is|get|has|webContents\.(get|is|can))/.test(m || ''))
  if (queryCalls.length < 10) {
    console.error('query 调用数过少:', queryCalls.length, queryCalls)
    process.exit(1)
  }
  console.log(
    `OK: lab smoke passed · ${observed.length} msgs · ${callWindowMethods.length} callWindow（含 ${queryCalls.length} 个 query）`
  )
})
