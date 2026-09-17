/* 轻量检查（不启动宿主，也不假装 BPP 握手） */
'use strict'
const path = require('path')
const fs = require('fs')
const assert = require('assert')

const root = path.resolve(__dirname, '..', '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
assert.ok(!manifest.kind || manifest.kind === 'brick')
assert.equal(manifest.id, 'com.brickly.local-search')
assert.ok(manifest.commands.some((c) => c.id === 'search'))
assert.ok(manifest.commands.some((c) => c.id === 'health'))
assert.ok(manifest.commands.some((c) => c.id === 'preview'))
assert.equal(manifest.runtime.type, 'native')
assert.ok(manifest.runtime.platforms.includes('win-x64'))

// provider 端点走 commands[].provider 标记；manifest.quickSearch 只留 consumer 声明
const quickSearch = manifest.commands.find((c) => c.id === 'quick-search')
assert.equal(quickSearch.provider?.type, 'search')
assert.ok(!('io' in quickSearch) && !('execution' in quickSearch) && !('hidden' in quickSearch))
assert.ok(!manifest.quickSearch)

const pin = JSON.parse(
  fs.readFileSync(path.join(root, '..', 'sdk-pin.json'), 'utf8')
)
const goMod = fs.readFileSync(path.join(root, 'src/runtime/go.mod'), 'utf8')
assert.ok(goMod.includes(`github.com/836145715/brickly-sdk-go v${pin.version}`))
assert.ok(!/^replace\s+github.com\/836145715\/brickly-sdk-go/m.test(goMod))

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'src/ui/package.json'), 'utf8'))
assert.equal(pkg.devDependencies['@syllm/brickly-ui'], `^${pin.version}`)

const main = fs.readFileSync(path.join(root, 'src/runtime/main.go'), 'utf8')
assert.ok(main.includes('plugin.OnCommand("search"'))
assert.ok(main.includes('plugin.OnCommand("health"'))
assert.ok(main.includes('plugin.Start()'))
assert.ok(!/\bhost\.hello\b/.test(main))
assert.ok(!main.includes('0.4.0'))
assert.ok(!main.includes('OnInteract'))

const bridge = fs.readFileSync(path.join(root, 'src/ui/bridge.ts'), 'utf8')
assert.ok(bridge.includes('window.brickly'))
assert.ok(bridge.includes("invoke<SearchResult>('search'"))
assert.ok(!bridge.includes('AIBricks'))

for (const rel of ['src/ui/App.tsx', 'src/ui/bridge.ts', 'src/runtime/main.go', 'manifest.json']) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`)
}

console.log('local-search smoke ok')
