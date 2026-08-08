const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')

const preloadSource = readFileSync(join(__dirname, '..', 'preload.cjs'), 'utf8')

function loadPreload(argv, invokeImpl) {
  let exposed
  const listeners = new Map()
  const context = {
    console,
    process: { argv },
    require(moduleName) {
      assert.equal(moduleName, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            exposed = { name, api }
          }
        },
        ipcRenderer: {
          invoke: invokeImpl,
          on(name, listener) {
            listeners.set(name, listener)
          }
        }
      }
    }
  }
  vm.runInNewContext(preloadSource, context, { filename: 'preload.cjs' })
  assert.equal(exposed.name, 'httpInspector')
  return exposed.api
}

function normalizeCalls(calls) {
  return calls
    .filter(([channel]) => channel !== 'platform.event.subscribe')
    .map((args) => args.map((value) => (
      value && typeof value === 'object' ? { ...value } : value
    )))
}

test('preload passes the injected development domain and refreshes that catalog once', async () => {
  const calls = []
  let bridgeAttempts = 0
  const api = loadPreload(
    ['electron', '--brickly-brick-domain=development'],
    async (...args) => {
      calls.push(args)
      if (args[0] === 'bridge.invoke' && ++bridgeAttempts === 1) {
        throw Object.assign(new Error('missing from stale catalog'), { code: 'BRICK_NOT_FOUND' })
      }
      return args[0] === 'platform.reloadBricks' ? { refreshed: true } : { ok: true }
    }
  )

  assert.deepEqual(await api.invoke('status', {}), { ok: true })
  assert.deepEqual(normalizeCalls(calls), [
    [
      'bridge.invoke',
      'com.brickly.http-inspector',
      'status',
      {},
      { brickId: 'com.brickly.http-inspector', sessionId: 'brick-ui:com.brickly.http-inspector' },
      undefined,
      'development'
    ],
    ['platform.reloadBricks', { domain: 'development' }],
    [
      'bridge.invoke',
      'com.brickly.http-inspector',
      'status',
      {},
      { brickId: 'com.brickly.http-inspector', sessionId: 'brick-ui:com.brickly.http-inspector' },
      undefined,
      'development'
    ]
  ])
})

test('preload keeps instance invocations out of the catalog refresh path', async () => {
  const calls = []
  const api = loadPreload(
    ['electron', '--brickly-instance-id=instance-1', '--brickly-brick-domain=installed'],
    async (...args) => {
      calls.push(args)
      return { ok: true }
    }
  )

  assert.deepEqual(await api.invoke('status', {}), { ok: true })
  assert.deepEqual(normalizeCalls(calls), [
    ['bricks.invokeInstance', 'instance-1', 'status', {}]
  ])
})
