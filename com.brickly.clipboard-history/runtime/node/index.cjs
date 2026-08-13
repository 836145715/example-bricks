/* eslint-disable */
'use strict'

const { BricklyRuntime, BppError, ResourceHandle } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.clipboard-history'
const HISTORY_EVENT = 'clipboard-history:changed'
const SOURCE_EVENT = 'clipboard:new-content'
const LOG_PREFIX = '[clipboard-history/runtime]'

const brick = new BricklyRuntime({ brickId: BRICK_ID })
const startedAt = Date.now()
let revision = 0
let processedEvents = 0
let lastEventAt
let lastEventKind
let lastError

function logInfo(message, detail) {
  if (detail === undefined) {
    brick.log.info(`${LOG_PREFIX} ${message}`)
    return
  }
  try {
    brick.log.info(`${LOG_PREFIX} ${message} ${JSON.stringify(detail)}`)
  } catch {
    brick.log.info(`${LOG_PREFIX} ${message}`)
  }
}

function logWarn(message, detail) {
  if (detail === undefined) {
    brick.log.warn(`${LOG_PREFIX} ${message}`)
    return
  }
  try {
    brick.log.warn(`${LOG_PREFIX} ${message} ${JSON.stringify(detail)}`)
  } catch {
    brick.log.warn(`${LOG_PREFIX} ${message}`)
  }
}

function historyApi(ctx) {
  const history = ctx?.platform?.clipboard?.history
  if (history) return history
  const call = (type, payload = {}) => brick.transport.hostCall({ type, ...payload })
  return {
    list: (limit) => call('host.platform.clipboard.history.list', { limit }),
    readText: (itemId) => call('host.platform.clipboard.history.readText', { itemId }),
    remove: (itemId) => call('host.platform.clipboard.history.remove', { itemId }),
    clear: (keepFavorites) =>
      call('host.platform.clipboard.history.clear', { keepFavorites }),
    setFavorite: (itemId, favorite) =>
      call('host.platform.clipboard.history.setFavorite', { itemId, favorite }),
    storageInfo: () => call('host.platform.clipboard.history.storageInfo'),
    captureCurrent: () => call('host.platform.clipboard.history.captureCurrent')
  }
}

function requireId(input) {
  const id = typeof input?.id === 'string' ? input.id.trim() : ''
  if (!id) throw new BppError('INVALID_INPUT', 'id is required')
  return id
}

function toUiItem(item) {
  const paths = Array.isArray(item.entries) ? item.entries.map((entry) => entry.path) : []
  const externalStatus = item.entries?.find((entry) => entry.status && entry.status !== 'available')?.status
  return {
    id: item.id,
    type: item.kind,
    mimeType: item.mimeType,
    title: item.title,
    preview: item.preview,
    path: paths[0],
    paths,
    imagePath: item.kind === 'image' && item.storageKind === 'blob' ? item.contentPath : undefined,
    imageOriginalPath: item.kind === 'image' && item.storageKind === 'external' ? paths[0] : undefined,
    width: item.width,
    height: item.height,
    size: item.sizeBytes,
    createdAt: item.createdAt,
    favorite: item.favorite,
    contentHash: item.contentHash,
    storageKind: item.storageKind,
    entries: item.entries,
    externalStatus
  }
}

async function publishChanged(reason, extra = {}) {
  revision++
  const payload = { revision, reason, at: Date.now(), ...extra }
  try {
    await brick.events.publish(HISTORY_EVENT, payload)
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    logWarn('publish failed', { event: HISTORY_EVENT, reason, revision, error: lastError })
  }
  return payload
}

brick.onCommand('list', async (ctx, input) => {
  const limit = input?.limit
  try {
    const items = await historyApi(ctx).list(limit)
    return { items: items.map(toUiItem) }
  } catch (error) {
    logWarn('list failed', {
      limit,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
})

brick.onCommand('read-text', (ctx, input) => historyApi(ctx).readText(requireId(input)))

brick.onCommand('remove', async (ctx, input) => {
  const ok = await historyApi(ctx).remove(requireId(input))
  if (ok) {
    const info = await historyApi(ctx).storageInfo()
    await publishChanged('remove', { count: info.count })
  }
  return { ok }
})

brick.onCommand('clear', async (ctx, input) => {
  const changed = await historyApi(ctx).clear(Boolean(input?.keepFavorites))
  if (changed > 0) {
    const info = await historyApi(ctx).storageInfo()
    await publishChanged('clear', { count: info.count })
  }
  return { ok: true, changed }
})

brick.onCommand('toggle-favorite', async (ctx, input) => {
  const id = requireId(input)
  const current = (await historyApi(ctx).list(500)).find((item) => item.id === id)
  if (!current) throw new BppError('NOT_FOUND', 'item not found')
  const favorite = !current.favorite
  await historyApi(ctx).setFavorite(id, favorite)
  const info = await historyApi(ctx).storageInfo()
  await publishChanged('favorite', { historyItemId: id, count: info.count })
  return { favorite }
})

brick.onCommand('storage-info', async (ctx) => {
  const info = await historyApi(ctx).storageInfo()
  return {
    brickId: BRICK_ID,
    dataDir: info.directory,
    dbPath: `${info.directory}/history.sqlite`,
    mediaDir: `${info.directory}/blobs`,
    ...info
  }
})

brick.onCommand('sync-now', async (ctx) => {
  const item = await historyApi(ctx).captureCurrent()
  if (!item) {
    return { changed: false, reason: 'sync', revision }
  }
  processedEvents++
  lastEventAt = Date.now()
  lastEventKind = item.kind
  const info = await historyApi(ctx).storageInfo()
  await publishChanged('sync', { historyItemId: item.id, count: info.count })
  return { changed: true, reason: 'sync', revision, item: toUiItem(item) }
})

brick.onCommand('set-content', async (ctx, input) => {
  const content = input?.content
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new BppError('INVALID_INPUT', 'content must be a clipboard content object')
  }
  return ctx.platform.clipboard.setContent(content)
})

brick.onCommand('runtime-status', async (ctx) => {
  const info = await historyApi(ctx).storageInfo()
  return {
    state: lastError ? 'error' : 'running',
    enabled: true,
    startedAt,
    uptimeMs: Date.now() - startedAt,
    count: info.count,
    maxItems: info.maxItems,
    dedupeHits: 0,
    processedEvents,
    lastEventAt,
    lastEventKind,
    lastError,
    revision
  }
})

brick.events.on(SOURCE_EVENT, (payload) => {
  void (async () => {
    if (!(payload instanceof ResourceHandle)) {
      throw new BppError('INVALID_INPUT', 'clipboard event payload must be a ResourceHandle')
    }
    const notice = await payload.json()
    if (!notice || typeof notice.historyItemId !== 'string') {
      throw new BppError('INVALID_INPUT', 'clipboard event resource is missing historyItemId')
    }
    processedEvents++
    lastEventAt = Date.now()
    lastEventKind = notice.kind
    await publishChanged('insert', {
      historyItemId: notice.historyItemId,
      kind: notice.kind,
      count: notice.count
    })
  })().catch((error) => {
    lastError = error instanceof Error ? error.message : String(error)
    logWarn('source event failed', { error: lastError })
  })
})

brick.onReady(() => logInfo('ready · Host clipboard history connected', { startedAt }))
brick.onShutdown(() => logInfo('shutdown'))
brick.start()
