/* 轻量检查（不启动宿主，也不假装 BPP 握手） */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')

const root = path.resolve(__dirname, '..', '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.kind, 'brick')
assert.equal(manifest.id, 'com.brickly.local-search')
assert.ok(manifest.commands.some((c) => c.id === 'search'))
assert.ok(manifest.commands.some((c) => c.id === 'health'))
assert.ok(manifest.commands.some((c) => c.id === 'preview'))
assert.equal(manifest.runtime.entry['win-x64'], 'runtime/win-x64/brick.exe')

const goMod = fs.readFileSync(path.join(root, 'runtime/go/go.mod'), 'utf8')
assert.ok(goMod.includes('github.com/836145715/brickly-sdk-go v0.7.0'))
assert.ok(!/^replace\s+github.com\/836145715\/brickly-sdk-go/m.test(goMod))

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(pkg.devDependencies['@syllm/brickly-ui'], '^0.6.0')

const main = fs.readFileSync(path.join(root, 'runtime/go/main.go'), 'utf8')
assert.ok(main.includes('plugin.OnCommand("search"'))
assert.ok(main.includes('plugin.OnCommand("health"'))
assert.ok(main.includes('plugin.Start()'))
assert.ok(!/\bhost\.hello\b/.test(main))
assert.ok(!main.includes('0.4.0'))
assert.ok(!main.includes('OnInteract'))

const bridge = fs.readFileSync(path.join(root, 'src/bridge.ts'), 'utf8')
assert.ok(bridge.includes('window.brickly'))
assert.ok(bridge.includes("invoke<SearchResult>('search'"))
assert.ok(!bridge.includes('AIBricks'))

for (const rel of ['src/App.tsx', 'src/bridge.ts', 'runtime/go/main.go', 'manifest.json']) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
}

console.log('local-search smoke ok')
