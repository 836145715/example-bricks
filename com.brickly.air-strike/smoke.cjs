/* 轻量检查（不启动宿主，也不假装 BPP 握手） */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')
const { execFileSync } = require('child_process')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.manifestVersion, 1)
assert.equal(manifest.id, 'com.brickly.air-strike')
assert.equal(manifest.runtime.type, 'node')
assert.equal(manifest.runtime.entry['win-x64'], 'runtime/win-x64/index.js')
assert.ok(!manifest.kind || manifest.kind === 'brick')

const strike = manifest.commands.find((c) => c.id === 'strike')
assert.ok(strike)
assert.equal(strike.mode, 'invoke')
assert.equal(strike.execution, 'parallel')
assert.equal(strike.window, undefined)

const hotkey = (manifest.hotkeys || []).find((h) => h.commandId === 'strike')
assert.ok(hotkey, 'strike hotkey missing')
assert.equal(hotkey.defaultBinding.win32.kind, 'accelerator')
assert.ok(hotkey.defaultBinding.win32.accelerator.length > 0)

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'runtime/win-x64/package.json'), 'utf8'))
const pin = JSON.parse(fs.readFileSync(path.join(root, '..', 'sdk-pin.json'), 'utf8'))
assert.equal(pkg.dependencies['@syllm/brickly-sdk'], `^${pin.version}`)

const runtimePath = path.join(root, 'runtime/win-x64/index.js')
const runtime = fs.readFileSync(runtimePath, 'utf8')
assert.ok(runtime.includes('BricklyRuntime'))
assert.ok(runtime.includes("onCommand('strike'"))
assert.ok(runtime.includes('ctx.ui.createBrowserWindow'))
assert.ok(runtime.includes('getDisplayNearestPoint'))
assert.ok(runtime.includes('brick.start()'))
assert.ok(!runtime.includes('lifetime'))
assert.ok(!runtime.includes('keepAlive'))

const overlayJs = fs.readFileSync(path.join(root, 'ui/overlay.js'), 'utf8')
assert.ok(overlayJs.includes("request('strike:init'"))
assert.ok(overlayJs.includes("'strike:done'"))
assert.ok(overlayJs.includes("'strike:cancel'"))
assert.ok(!overlayJs.includes('sendToParent'))

for (const rel of ['ui/overlay.html', 'ui/overlay.css', 'ui/overlay.js', 'runtime/win-x64/index.js']) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
}

execFileSync(process.execPath, ['--check', runtimePath], { stdio: 'pipe' })
execFileSync(process.execPath, ['--check', path.join(root, 'ui/overlay.js')], { stdio: 'pipe' })

console.log('air-strike smoke ok')
