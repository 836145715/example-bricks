const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const SERVICE_PATH = path.join(__dirname, 'history-service.cjs')

test('事件与同步快照共用 ingest，并只为真实变化增加 revision', (t) => {
  const harness = createHarness(t)
  const first = harness.service.ingest(
    { kind: 'text', text: 'hello', capturedAt: 100 },
    clipboardEnvelope(100)
  )
  harness.setNow(1200)
  const duplicate = harness.service.ingest(
    { kind: 'text', text: 'hello', capturedAt: 1200 },
    { ...clipboardEnvelope(1200), event: 'clipboard:sync-now' }
  )

  assert.equal(first.changed, true)
  assert.equal(first.reason, 'insert')
  assert.equal(first.revision, 1)
  assert.equal(duplicate.changed, false)
  assert.equal(harness.service.status().revision, 1)
  assert.equal(harness.service.status().dedupeHits, 1)
  assert.equal(harness.service.status().processedEvents, 2)
  assert.equal(harness.service.list().length, 1)
  assert.equal(harness.service.list()[0].text, 'hello')
})

test('删除、清空和收藏仅在状态真实变化时产生 mutation', (t) => {
  const harness = createHarness(t)
  const inserted = harness.service.ingest(
    { kind: 'text', text: 'first', capturedAt: 100 },
    clipboardEnvelope(100)
  )
  harness.setNow(1200)
  harness.service.ingest(
    { kind: 'text', text: 'second', capturedAt: 1200 },
    clipboardEnvelope(1200)
  )

  const missing = harness.service.remove('missing')
  const favorite = harness.service.toggleFavorite(inserted.item.id)
  const clear = harness.service.clear(true)
  const emptyClear = harness.service.clear(true)

  assert.equal(missing.changed, false)
  assert.equal(favorite.changed, true)
  assert.equal(favorite.reason, 'favorite')
  assert.equal(favorite.favorite, true)
  assert.equal(clear.changed, true)
  assert.equal(clear.reason, 'clear')
  assert.equal(harness.service.list().length, 1)
  assert.equal(harness.service.list()[0].favorite, true)
  assert.equal(emptyClear.changed, false)
  assert.equal(harness.service.status().revision, 4)
})

test('沿用现有 history.json 并保持收藏数据格式', (t) => {
  const root = makeTempRoot(t)
  const paths = historyPaths(root)
  fs.mkdirSync(paths.mediaDir, { recursive: true })
  fs.writeFileSync(
    paths.dbPath,
    JSON.stringify({
      items: [
        {
          id: 'clip_existing',
          type: 'text',
          text: 'existing',
          contentHash: 'existing-hash',
          createdAt: 10,
          favorite: true
        }
      ]
    }),
    'utf8'
  )

  const service = createService(paths, () => 1000)

  assert.equal(service.list()[0].id, 'clip_existing')
  assert.equal(service.list()[0].favorite, true)
  assert.equal(service.storageInfo().dbPath, paths.dbPath)
  assert.equal(service.storageInfo().count, 1)
})

test('history.json 损坏时降级为空状态并记录错误', (t) => {
  const root = makeTempRoot(t)
  const paths = historyPaths(root)
  fs.mkdirSync(paths.mediaDir, { recursive: true })
  fs.writeFileSync(paths.dbPath, '{ invalid json', 'utf8')

  const service = createService(paths, () => 1000)

  assert.deepEqual(service.list(), [])
  assert.match(service.status().lastError, /JSON|Unexpected|position/i)
})

test('图片入库继续复制到 media 目录且事件状态不泄露正文', (t) => {
  const harness = createHarness(t)
  const sourcePath = path.join(harness.root, 'source.png')
  fs.writeFileSync(sourcePath, Buffer.from('fake-png'))

  const mutation = harness.service.ingest(
    {
      kind: 'image',
      path: sourcePath,
      name: 'source.png',
      width: 10,
      height: 20,
      capturedAt: 100
    },
    clipboardEnvelope(100),
    { filePath: sourcePath, mimeType: 'image/png', size: 8 }
  )

  assert.equal(mutation.changed, true)
  assert.equal(mutation.item.type, 'image')
  assert.equal(path.dirname(mutation.item.imagePath), harness.paths.mediaDir)
  assert.equal(fs.existsSync(mutation.item.imagePath), true)
  assert.deepEqual(Object.keys(harness.service.status()).includes('items'), false)
})

function createHarness(t) {
  const root = makeTempRoot(t)
  const paths = historyPaths(root)
  let now = 1000
  return {
    root,
    paths,
    service: createService(paths, () => now),
    setNow(value) {
      now = value
    }
  }
}

function createService(paths, now) {
  assert.equal(fs.existsSync(SERVICE_PATH), true, 'history-service.cjs 应存在')
  delete require.cache[require.resolve(SERVICE_PATH)]
  const { createHistoryService } = require(SERVICE_PATH)
  return createHistoryService({
    ...paths,
    now,
    log() {}
  })
}

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brickly-history-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function historyPaths(root) {
  const dataDir = path.join(root, 'com.brickly.clipboard-history')
  return {
    dataDir,
    mediaDir: path.join(dataDir, 'media'),
    dbPath: path.join(dataDir, 'history.json')
  }
}

function clipboardEnvelope(publishedAt) {
  return {
    event: 'clipboard:new-content',
    sourceBrickId: 'system',
    publishedAt
  }
}
