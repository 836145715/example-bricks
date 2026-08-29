/* 轻量检查（不启动宿主，也不假装 BPP 握手） */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.manifestVersion, 1)
assert.equal(manifest.id, 'com.brickly.go-window-lab')
assert.ok(manifest.commands.some((c) => c.id === 'open-lab'))
assert.ok(manifest.commands.some((c) => c.id === 'close-lab'))
assert.ok(!String(manifest.runtime.entry['win-x64'] || '').includes('runtime/node'))

const goMod = fs.readFileSync(path.join(root, 'runtime/go/go.mod'), 'utf8')
assert.ok(goMod.includes('github.com/836145715/brickly-sdk-go v0.6.0'))
assert.ok(!/^replace\s+github.com\/836145715\/brickly-sdk-go/m.test(goMod))

const main = fs.readFileSync(path.join(root, 'runtime/go/main.go'), 'utf8')
assert.ok(main.includes('plugin.OnCommand("open-lab"'))
assert.ok(main.includes('plugin.OnCommand("close-lab"'))
assert.ok(main.includes('plugin.Start()'))
assert.ok(!/\bhost\.hello\b/.test(main))
assert.ok(!main.includes('0.4.0'))
assert.ok(!main.includes('OnInteract'))

const labJs = fs.readFileSync(path.join(root, 'ui/lab.js'), 'utf8')
assert.ok(labJs.includes("window.brickly.request('op'"))
assert.ok(labJs.includes("window.brickly.request('query')"))
assert.ok(labJs.includes('window.brickly.ref'))
assert.ok(!labJs.includes('brickly.parent'))
assert.ok(!labJs.includes('sendToParent'))
assert.ok(!labJs.includes('brickly:closing'))
assert.ok(!labJs.includes('AIBricks'))
assert.ok(!labJs.includes('window.brickly.brickId'))
assert.ok(!/\bhost\.hello\b/.test(labJs))
assert.ok(!labJs.includes('0.4.0'))

for (const rel of ['ui/lab.html', 'ui/lab.js', 'ui/lab.css', 'runtime/go/main.go']) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
}

console.log('go-window-lab smoke ok')
