const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const ROOT = __dirname
const ADAPTER_PATH = path.join(ROOT, 'src', 'brickly.ts')

test('UI CRUD、同步和写回全部调用当前 Brick runtime', async (t) => {
  const calls = []
  const api = loadAdapter(t, {
    brickly: {
      invoke: async (commandId, input) => {
        calls.push([commandId, input])
        if (commandId === 'list') return { items: [{ id: 'clip-1' }] }
        if (commandId === 'remove') return { ok: true }
        if (commandId === 'toggle-favorite') return { favorite: true }
        if (commandId === 'storage-info') return { count: 1 }
        if (commandId === 'runtime-status') return { state: 'running', revision: 2 }
        if (commandId === 'sync-now') return { changed: true, revision: 2, count: 1 }
        if (commandId === 'set-content') {
          return { kind: 'text', formats: ['text/plain'], updatedAt: 10 }
        }
        return { ok: true }
      },
      system: {
        getFileIcon: async (filePath) => `icon:${filePath}`
      }
    }
  })

  assert.equal((await api.listHistory())[0].id, 'clip-1')
  assert.equal(await api.removeHistoryItem('clip-1'), true)
  await api.clearHistory(true)
  assert.equal(await api.toggleHistoryFavorite('clip-1'), true)
  assert.equal((await api.getStorageInfo()).count, 1)
  assert.equal((await api.getRuntimeStatus()).revision, 2)
  assert.equal((await api.syncClipboardNow()).changed, true)
  assert.equal(
    (await api.setClipboardContent({ kind: 'text', text: 'hello' })).kind,
    'text'
  )
  assert.equal(await api.getFileIcon('C:\\demo.txt'), 'icon:C:\\demo.txt')

  assert.equal(
    JSON.stringify(calls),
    JSON.stringify([
      ['list', { limit: 500 }],
      ['remove', { id: 'clip-1' }],
      ['clear', { keepFavorites: true }],
      ['toggle-favorite', { id: 'clip-1' }],
      ['storage-info', {}],
      ['runtime-status', {}],
      ['sync-now', {}],
      ['set-content', { content: { kind: 'text', text: 'hello' } }]
    ])
  )
})

test('事件订阅只使用 Clipboard History 的窄 preload API', async (t) => {
  const received = []
  let disposed = false
  let registeredListener
  const api = loadAdapter(t, {
    brickly: { invoke: async () => null, system: { getFileIcon: async () => '' } },
    clipboardHistoryEvents: {
      async subscribe(listener) {
        registeredListener = listener
        return async () => {
          disposed = true
        }
      }
    }
  })

  const dispose = await api.subscribeHistoryChanged((envelope) => received.push(envelope))
  registeredListener({
    event: 'clipboard-history:changed',
    sourceBrickId: 'com.brickly.clipboard-history',
    publishedAt: 100,
    payload: { revision: 1, count: 2, reason: 'insert', at: 100 }
  })

  assert.equal(received.length, 1)
  assert.equal(received[0].payload.revision, 1)
  await dispose()
  assert.equal(disposed, true)
})

test('宿主命令或事件接口缺失时返回明确错误', async (t) => {
  const api = loadAdapter(t, {})

  await assert.rejects(() => api.listHistory(), /Clipboard History runtime/)
  await assert.rejects(() => api.subscribeHistoryChanged(() => {}), /事件接口/)
  await assert.rejects(() => api.getFileIcon('C:\\demo.txt'), /文件图标接口/)
})

function loadAdapter(t, windowValue) {
  assert.equal(fs.existsSync(ADAPTER_PATH), true, 'src/brickly.ts 应存在')
  const source = fs.readFileSync(ADAPTER_PATH, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: ADAPTER_PATH,
    reportDiagnostics: true
  })
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  )
  assert.deepEqual(errors, [])

  const previousWindow = global.window
  global.window = windowValue
  t.after(() => {
    global.window = previousWindow
  })
  const module = { exports: {} }
  const execute = new Function('exports', 'require', 'module', compiled.outputText)
  execute(module.exports, require, module)
  return module.exports
}
