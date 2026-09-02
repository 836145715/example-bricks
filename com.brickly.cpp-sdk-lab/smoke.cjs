/* 对照 create-brickly --runtime go --ui h5 --preset window。不启动宿主。 */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')
const { spawnSync } = require('child_process')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.manifestVersion, 1)
assert.equal(manifest.kind, 'brick')
assert.equal(manifest.id, 'com.brickly.cpp-sdk-lab')
assert.equal(manifest.runtime.type, 'native')
assert.equal(manifest.runtime.instance, 'owned')
assert.equal(manifest.ui && manifest.ui.type, 'webview')
assert.equal(manifest.ui.entry, 'ui/index.html')
assert.equal(manifest.icon, 'assets/icon.svg')

const commandIds = (manifest.commands || []).map((c) => c.id)
assert.deepEqual(commandIds, ['timer', 'pin'])
const timer = manifest.commands.find((c) => c.id === 'timer')
const pin = manifest.commands.find((c) => c.id === 'pin')
assert.equal(timer.window, 'attach')
assert.equal(timer.mode, 'interact')
assert.equal(pin.window, 'standalone')
assert.equal(pin.mode, 'interact')
assert.ok(!String(manifest.runtime.entry['win-x64'] || '').includes('runtime/node'))

const main = fs.readFileSync(path.join(root, 'runtime/cpp/main.cpp'), 'utf8')
assert.ok(main.includes('#include <nlohmann/json.hpp>'))
assert.ok(main.includes('on_command("timer"'))
assert.ok(main.includes('on_command("pin"'))
assert.ok(main.includes('create_browser_window'))
assert.ok(main.includes('ui/window.html'))
assert.ok(main.includes('lifetime'))
assert.ok(main.includes('expose("pause"'))
assert.ok(main.includes('expose("resume"'))
assert.ok(main.includes('expose("reset"'))
assert.ok(main.includes('on_event'))
assert.ok(main.includes('send("tick"'))
assert.ok(main.includes('runtime.start()'))
assert.ok(!/\bhost\.hello\b/.test(main))
assert.ok(!main.includes('json_lite.hpp'))
assert.ok(!main.includes('on_command("hello"'))
assert.ok(!main.includes('on_command("open-lab"'))
assert.ok(!main.includes('sendToParent'))

const app = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8')
assert.ok(app.includes('window.brickly.start()'))
assert.ok(app.includes("interact(commandId"))
assert.ok(app.includes('onEvent'))
assert.ok(app.includes('session.send'))
assert.ok(app.includes("open('timer')") || app.includes('open("timer")') || app.includes("() => open('timer')"))
assert.ok(!app.includes('result.finally'))

const childPage = fs.readFileSync(path.join(root, 'ui/window.html'), 'utf8')
assert.ok(childPage.includes("request?.('pause')"))
assert.ok(childPage.includes("on?.('tick'"))
assert.ok(!childPage.includes('sendToParent'))

for (const rel of [
  'runtime/cpp/main.cpp',
  'runtime/cpp/nlohmann/json.hpp',
  'runtime/cpp/build.mjs',
  'ui/index.html',
  'ui/app.js',
  'ui/style.css',
  'ui/window.html',
  'ui/window.css',
  'assets/icon.svg',
  'manifest.json'
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
}

for (const rel of ['ui/lab.html', 'ui/lab.css', 'ui/lab.js']) {
  assert.ok(!fs.existsSync(path.join(root, rel)), `stale ${rel}`)
}

function currentPlatform() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  return null
}

const platform = currentPlatform()
if (platform) {
  const exeName = process.platform === 'win32' ? 'brick.exe' : 'brick'
  const libName =
    process.platform === 'win32' ? 'brickly.dll' : process.platform === 'darwin' ? 'libbrickly.dylib' : 'libbrickly.so'
  const exe = path.join(root, 'runtime', platform, exeName)
  if (fs.existsSync(exe)) {
    assert.ok(fs.existsSync(path.join(root, 'runtime', platform, libName)), `missing sidecar ${libName}`)
    if (process.platform === 'darwin') {
      const otool = spawnSync('otool', ['-L', exe], { encoding: 'utf8' })
      assert.equal(otool.status, 0, otool.stderr)
      assert.ok(
        /@rpath\/libbrickly\.dylib/.test(otool.stdout),
        `macOS 入口必须按 @rpath 引用 sidecar，否则宿主 cwd（Brick 根目录）下 dyld 找不到。otool=${otool.stdout}`
      )
    }
    const result = spawnSync(exe, [], {
      encoding: 'utf8',
      timeout: 20000,
      cwd: root,
      env: { ...process.env, BRICKLY_HOST_ENDPOINT: '', BRICKLY_BOOTSTRAP: '' }
    })
    const combined = `${result.stderr || ''}\n${result.stdout || ''}`
    assert.ok(
      !/Library not loaded|image not found|cannot open shared object file/i.test(combined),
      `sidecar 动态库未能随入口加载（宿主 cwd 是 Brick 根目录）。stderr=${combined}`
    )
    assert.notEqual(
      result.status,
      -1073741701,
      `native 入口无法加载（0xC000007B）。Windows 上 c-shared 需要 -ldflags="-s -w"。stderr=${result.stderr || ''}`
    )
    assert.ok(!result.error, result.error && result.error.message)
    assert.ok(
      result.status === 0 || result.status === 1,
      `unexpected exit ${result.status} signal=${result.signal} stderr=${result.stderr || ''}`
    )
  }
}

console.log('cpp-sdk-lab smoke ok')
