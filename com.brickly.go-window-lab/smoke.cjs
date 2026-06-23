/* eslint-disable */
/**
 * Go 窗口实验室 · 端到端冒烟测试
 *
 * 与 com.brickly.demo-window-lab/smoke.cjs 完全等价，只是把子进程换成 Go 二进制。
 * 通过这一份测试同时验证：
 *   - brickly-sdk-go 的 stdin/stdout NDJSON 通路
 *   - host.hello → runtime.ready 握手
 *   - host.ui.createBrowserWindow 请求-响应配对
 *   - host.ui.callWindow 反射调用（含 webContents.* 子方法）
 *   - window.message 事件路由
 *   - runtime.shutdown → runtime.bye 退出
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const isWin = process.platform === 'win32'
const binDir = isWin ? 'win-x64' : process.platform === 'darwin' ? 'mac-x64' : 'linux-x64'
const exe = isWin ? 'brick.exe' : 'brick'
const binPath = path.resolve(__dirname, 'bin', binDir, exe)

if (!fs.existsSync(binPath)) {
  console.error('binary not found, run runtime/go/build.ps1 first:', binPath)
  process.exit(2)
}

const child = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })

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
    console.log('<<', msg.type, msg.method ? `· ${msg.method}` : '', msg.id ? `id=${msg.id}` : '')

    if (msg.type === 'host.ui.createBrowserWindow') {
      send({ type: 'host.result', id: msg.id, result: { windowId: winId } })
    } else if (msg.type === 'host.ui.callWindow') {
      const m = msg.method
      let fake = null
      if (m === 'getBounds' || m === 'getContentBounds' || m === 'getNormalBounds')
        fake = { x: 100, y: 100, width: 980, height: 720 }
      else if (m === 'getPosition') fake = [100, 100]
      else if (m === 'getSize' || m === 'getContentSize') fake = [980, 720]
      else if (m === 'getMinimumSize') fake = [0, 0]
      else if (m === 'getMaximumSize') fake = [0, 0]
      else if (m === 'getOpacity') fake = 1
      else if (m === 'getTitle') fake = 'Brickly Go Lab'
      else if (m && m.startsWith('is'))
        fake = m === 'isVisible' || m === 'isFocusable' || m === 'isNormal'
      else if (m === 'hasShadow') fake = true
      else if (m === 'webContents.getURL') fake = 'file:///lab.html'
      else if (m === 'webContents.getTitle') fake = 'Brickly Go Lab'
      else if (m === 'webContents.getZoomFactor') fake = 1
      else if (m === 'webContents.getZoomLevel') fake = 0
      else if (
        m === 'webContents.isDevToolsOpened' ||
        m === 'webContents.canGoBack' ||
        m === 'webContents.canGoForward'
      )
        fake = false
      send({ type: 'host.result', id: msg.id, result: fake })
    } else if (msg.type === 'host.ui.closeWindow') {
      send({ type: 'host.result', id: msg.id, result: null })
    }
  }
})

child.stderr.setEncoding('utf8')
child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d))

send({ type: 'host.hello', protocolVersion: '0.1.0' })

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
}, 1300)

setTimeout(() => {
  send({ type: 'runtime.shutdown' })
}, 3000)

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
  if (!callWindowMethods.includes('maximize')) {
    console.error('未观察到 maximize 调用，callWindow=', callWindowMethods)
    process.exit(1)
  }
  const queryCalls = callWindowMethods.filter((m) =>
    /^(is|get|has|webContents\.(get|is|can))/.test(m || '')
  )
  if (queryCalls.length < 10) {
    console.error('query 调用数过少:', queryCalls.length, queryCalls)
    process.exit(1)
  }
  // 必须看到 webContents.send 用来推回 lab:result 与 lab:state
  const wcSends = callWindowMethods.filter((m) => m === 'webContents.send').length
  if (wcSends < 2) {
    console.error('webContents.send 次数不足（应至少 2 次：lab:result + lab:state），实际:', wcSends)
    process.exit(1)
  }
  console.log(
    `OK: Go lab smoke passed · ${observed.length} msgs · ${callWindowMethods.length} callWindow（含 ${queryCalls.length} 个 query · ${wcSends} 次 webContents.send）`
  )
})
