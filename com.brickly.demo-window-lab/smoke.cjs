/* 轻量检查（不启动宿主，也不假装 BPP 握手） */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')
const { execFileSync } = require('child_process')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.manifestVersion, 1)
assert.equal(manifest.id, 'com.brickly.demo-window-lab')
assert.ok(manifest.commands.some((c) => c.id === 'open-lab'))
assert.ok(manifest.commands.some((c) => c.id === 'close-lab'))

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'runtime/win-x64/package.json'), 'utf8'))
assert.equal(pkg.dependencies['@syllm/brickly-sdk'], '^0.6.0')

const runtimePath = path.join(root, 'runtime/win-x64/index.js')
const runtime = fs.readFileSync(runtimePath, 'utf8')
assert.ok(runtime.includes('BricklyRuntime'))
assert.ok(runtime.includes("onCommand('open-lab'"))
assert.ok(runtime.includes('plugin.start()'))
assert.ok(!/\bhost\.hello\b/.test(runtime))
assert.ok(!runtime.includes('0.4.0'))
assert.ok(!runtime.includes('AIBricks'))

const labJs = fs.readFileSync(path.join(root, 'ui/lab.js'), 'utf8')
assert.ok(labJs.includes("window.brickly.request('op'"))
assert.ok(labJs.includes("window.brickly.request('query')"))
assert.ok(labJs.includes('window.brickly.ref'))
assert.ok(!labJs.includes('brickly.parent'))
assert.ok(!labJs.includes('sendToParent'))
assert.ok(!labJs.includes('brickly:closing'))
assert.ok(!labJs.includes('AIBricks'))
assert.ok(!labJs.includes('window.brickly.brickId'))

for (const rel of ['ui/lab.html', 'ui/lab.js', 'ui/lab.css', 'runtime/win-x64/index.js']) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
}

execFileSync(process.execPath, ['--check', runtimePath], { stdio: 'pipe' })
execFileSync(process.execPath, ['--check', path.join(root, 'ui/lab.js')], { stdio: 'pipe' })

console.log('demo-window-lab smoke ok')
