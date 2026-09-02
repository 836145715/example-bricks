/* 轻量检查：不启动宿主。若本地已编过 native 入口，顺带确认进程能加载。 */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')
const { spawnSync } = require('child_process')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.manifestVersion, 1)
assert.equal(manifest.id, 'com.brickly.cpp-sdk-lab')
assert.equal(manifest.runtime.type, 'native')
assert.ok(manifest.commands.some((c) => c.id === 'hello'))
assert.ok(manifest.commands.some((c) => c.id === 'runtime-info'))
assert.ok(manifest.commands.some((c) => c.id === 'make-note'))
assert.ok(manifest.commands.some((c) => c.id === 'chat' && c.mode === 'interact'))
assert.ok(!String(manifest.runtime.entry['win-x64'] || '').includes('runtime/node'))

const main = fs.readFileSync(path.join(root, 'runtime/cpp/main.cpp'), 'utf8')
assert.ok(main.includes('on_command("hello"'))
assert.ok(main.includes('on_command("runtime-info"'))
assert.ok(main.includes('on_command("make-note"'))
assert.ok(main.includes('on_command("chat"'))
assert.ok(main.includes('runtime.start()'))
assert.ok(!/\bhost\.hello\b/.test(main))

for (const rel of ['runtime/cpp/main.cpp', 'runtime/cpp/json_lite.hpp', 'runtime/cpp/build.mjs', 'manifest.json']) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
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
    // 宿主 BrickProcess 的 cwd 是 Brick 根目录，不是 runtime/<platform>/。
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
