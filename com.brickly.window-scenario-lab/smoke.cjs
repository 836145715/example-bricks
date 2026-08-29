/* 轻量检查（不启动宿主） */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.manifestVersion, 1)
assert.equal(manifest.id, 'com.brickly.window-scenario-lab')
assert.ok(manifest.commands.some((c) => c.id === 'open-control'))
assert.ok(manifest.commands.some((c) => c.id === 'list-win-sessions'))

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'runtime/win-x64/package.json'), 'utf8'))
assert.equal(pkg.dependencies['@syllm/brickly-sdk'], '^0.6.0')

const runtimeDir = path.join(root, 'runtime/win-x64')
const files = [
  'index.js',
  'scenarios.js',
  'win-session-store.js',
  'notify.js',
  'bind-win-session.js',
  'open-windows.js',
  'control-messages.js'
]
for (const f of files) {
  assert.ok(fs.existsSync(path.join(runtimeDir, f)), `missing ${f}`)
}

const index = fs.readFileSync(path.join(runtimeDir, 'index.js'), 'utf8')
assert.ok(index.includes("require('./open-windows')"))
assert.ok(index.includes('list-win-sessions'))
assert.ok(index.includes('BricklyRuntime'))
assert.ok(index.includes('plugin.start()'))
assert.ok(!/\bhost\.hello\b/.test(index))
assert.ok(!index.includes('0.4.0'))
assert.ok(!index.includes('AIBricks'))

const controlJs = fs.readFileSync(path.join(root, 'ui/control.js'), 'utf8')
assert.ok(controlJs.includes('window.brickly.notify'))
assert.ok(controlJs.includes('window.brickly.ref'))
assert.ok(!controlJs.includes('window.brickly.brickId'))
assert.ok(!controlJs.includes('AIBricks'))

const childJs = fs.readFileSync(path.join(root, 'ui/child.js'), 'utf8')
assert.ok(childJs.includes('window.brickly.notify'))
assert.ok(childJs.includes('window.brickly.ref'))
assert.ok(!childJs.includes('window.brickly.brickId'))
assert.ok(!childJs.includes('AIBricks'))

const bind = fs.readFileSync(path.join(runtimeDir, 'bind-win-session.js'), 'utf8')
assert.ok(bind.includes('handle.expose'))

for (const rel of [
  'ui/control.html',
  'ui/control.js',
  'ui/control.css',
  'ui/child.html',
  'ui/child.js',
  'ui/child.css'
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
}

// syntax check modules
for (const f of files) {
  require('child_process').execFileSync(process.execPath, ['--check', path.join(runtimeDir, f)], {
    stdio: 'pipe'
  })
}

console.log('window-scenario-lab smoke ok')
