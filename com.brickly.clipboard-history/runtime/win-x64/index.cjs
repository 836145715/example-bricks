/* eslint-disable */
'use strict'

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')
const fs = require('node:fs/promises')
const path = require('node:path')
const { basename } = require('node:path')

const BRICK_ID = 'com.brickly.clipboard-history'
const HISTORY_EVENT = 'clipboard-history:changed'
const SOURCE_EVENT = 'clipboard:new-content'
const LOG_PREFIX = '[clipboard-history/runtime]'
const COLLECTION = 'clips'
const MAX_ITEMS = 500
const INLINE_LIMIT = 1024 * 1024

const brick = new BricklyRuntime()
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

function clips() {
  return brick.storage.collection(COLLECTION, { scope: 'local' })
}

function requireId(input) {
  const id = typeof input?.id === 'string' ? input.id.trim() : ''
  if (!id) throw new BppError('INVALID_INPUT', 'id is required')
  return id
}

function toUiItem(item) {
  const paths = Array.isArray(item.paths)
    ? item.paths
    : Array.isArray(item.entries)
      ? item.entries.map((entry) => entry.path)
      : []
  const externalStatus = item.entries?.find((entry) => entry.status && entry.status !== 'available')?.status
  return {
    id: item.id,
    type: item.kind,
    mimeType: item.mimeType,
    title: item.title,
    preview: item.preview,
    text: item.text,
    path: paths[0],
    paths,
    imagePath: item.kind === 'image' && item.storageKind !== 'external' ? item.contentPath : undefined,
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
    lastError = undefined
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    logWarn('publish failed', { event: HISTORY_EVENT, reason, revision, error: lastError })
  }
  return payload
}

async function listClips(limit) {
  const all = await clips().list()
  all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(2000, Math.floor(limit))) : MAX_ITEMS
  return all.slice(0, cap)
}

async function dataDir() {
  return brick.getPath('data')
}

function asHandle(resource) {
  if (!resource) return undefined
  if (typeof resource.saveTo === 'function') return resource
  if (resource.kind === 'brickly.resource' && typeof brick.resources?.open === 'function') {
    return brick.resources.open(resource)
  }
  return undefined
}

function previewOf(kind, text, paths) {
  if (kind === 'text') {
    const value = typeof text === 'string' ? text : ''
    const line = value.split(/\r?\n/, 1)[0] ?? ''
    return line.slice(0, 160) || '文本'
  }
  if (kind === 'image') return '图像'
  if (Array.isArray(paths) && paths.length === 1) return basename(paths[0])
  if (Array.isArray(paths) && paths.length > 1) return `${paths.length} 个项目`
  return '剪贴板'
}

function titleOf(kind, text, paths, name) {
  if (typeof name === 'string' && name) return name
  if (kind === 'text') {
    const line = (typeof text === 'string' ? text : '').split(/\r?\n/, 1)[0]?.trim() ?? ''
    return line.slice(0, 80) || '文本'
  }
  if (kind === 'image') return '图像'
  if (Array.isArray(paths) && paths.length === 1) return basename(paths[0])
  if (Array.isArray(paths) && paths.length > 1) return `${paths.length} 个项目`
  return '剪贴板'
}

function captureKind(capture) {
  if (capture?.kind === 'text' || capture?.kind === 'file' || capture?.kind === 'image') return capture.kind
  return undefined
}

async function persistOverflow(kind, hash, handle, text) {
  const root = await dataDir()
  const folder = path.join(root, 'blobs', kind === 'image' ? 'image' : 'text')
  await fs.mkdir(folder, { recursive: true })
  const ext = kind === 'image' ? '.png' : '.txt'
  const dest = path.join(folder, `${hash}${ext}`)
  if (handle) {
    await handle.saveTo(dest)
    return dest
  }
  await fs.writeFile(dest, text ?? '', 'utf8')
  return dest
}

async function ingestCapture(capture, reason) {
  const kind = captureKind(capture)
  const hash = typeof capture?.hash === 'string' ? capture.hash : ''
  if (!kind || !hash) {
    throw new BppError('INVALID_INPUT', 'clipboard capture is missing kind or hash')
  }
  const existing = (await clips().list({ equals: { contentHash: hash } }))[0]
  if (existing) {
    lastEventKind = kind
    lastEventAt = Date.now()
    processedEvents++
    const count = (await clips().list()).length
    await publishChanged(reason === 'sync' ? 'sync' : 'reuse', {
      historyItemId: existing.id,
      kind,
      count
    })
    return { changed: false, reason: 'reuse', item: existing }
  }

  const paths = Array.isArray(capture.paths)
    ? capture.paths
    : typeof capture.path === 'string' && capture.path
      ? [capture.path]
      : []
  const handle = asHandle(capture.resource)
  const text = typeof capture.text === 'string' ? capture.text : undefined
  const sizeBytes =
    typeof capture.size === 'number'
      ? capture.size
      : typeof text === 'string'
        ? Buffer.byteLength(text, 'utf8')
        : handle?.ref?.sizeBytes ?? 0
  const overflow = Boolean(handle) && (kind === 'image' || sizeBytes > INLINE_LIMIT)
  const inlineText = kind === 'text' && text && Buffer.byteLength(text, 'utf8') <= INLINE_LIMIT && !overflow
  let contentPath
  let storageKind = kind === 'file' ? 'external' : 'inline'
  if (kind === 'file' || (kind === 'image' && paths.length && !handle)) {
    storageKind = 'external'
  } else if (overflow || (kind === 'image' && handle) || (kind === 'text' && !inlineText && (handle || text))) {
    contentPath = await persistOverflow(kind, hash, handle, text)
    storageKind = 'file'
  }

  const created = await clips().create({
    kind,
    storageKind,
    mimeType: capture.mimeType,
    title: titleOf(kind, text, paths, capture.name),
    preview: previewOf(kind, text, paths),
    contentHash: hash,
    sizeBytes,
    createdAt: typeof capture.capturedAt === 'number' ? capture.capturedAt : Date.now(),
    favorite: false,
    width: capture.width,
    height: capture.height,
    ...(inlineText ? { text } : {}),
    ...(contentPath ? { contentPath } : {}),
    ...(paths.length ? { paths } : {}),
    ...(kind === 'file' || storageKind === 'external'
      ? {
          entries: paths.map((itemPath) => ({
            path: itemPath,
            name: basename(itemPath),
            kind: 'file',
            sizeBytes: 0,
            modifiedAt: 0
          }))
        }
      : {})
  })

  await pruneOverflow()
  lastEventKind = kind
  lastEventAt = Date.now()
  processedEvents++
  const count = (await clips().list()).length
  await publishChanged(reason === 'sync' ? 'sync' : 'insert', {
    historyItemId: created.id,
    kind,
    count
  })
  return { changed: true, reason: 'insert', item: created }
}

async function pruneOverflow() {
  const items = await listClips(2000)
  if (items.length <= MAX_ITEMS) return
  let extra = items.length - MAX_ITEMS
  const oldest = items.filter((entry) => !entry.favorite).reverse()
  for (const item of oldest) {
    if (extra <= 0) break
    await removeClip(item.id, item)
    extra -= 1
  }
}

async function removeClip(id, known) {
  const item = known ?? (await clips().get(id))
  if (!item) return false
  await clips().delete(id)
  if (typeof item.contentPath === 'string' && item.contentPath) {
    try {
      await fs.unlink(item.contentPath)
    } catch {
      // 文件可能已被用户删
    }
  }
  return true
}

brick.onCommand('list', async (_ctx, input) => {
  try {
    const items = await listClips(input?.limit)
    return { items: items.map(toUiItem) }
  } catch (error) {
    logWarn('list failed', {
      limit: input?.limit,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
})

brick.onCommand('read-text', async (_ctx, input) => {
  const id = requireId(input)
  const item = await clips().get(id)
  if (!item) throw new BppError('NOT_FOUND', 'item not found')
  if (typeof item.text === 'string') return item.text
  if (typeof item.contentPath === 'string' && item.contentPath) {
    return fs.readFile(item.contentPath, 'utf8')
  }
  throw new BppError('NOT_FOUND', 'text content is not available')
})

brick.onCommand('remove', async (_ctx, input) => {
  const ok = await removeClip(requireId(input))
  if (ok) {
    const count = (await clips().list()).length
    await publishChanged('remove', { count })
  }
  return { ok }
})

brick.onCommand('clear', async (_ctx, input) => {
  const keepFavorites = Boolean(input?.keepFavorites)
  const items = await clips().list()
  let changed = 0
  for (const item of items) {
    if (keepFavorites && item.favorite) continue
    if (await removeClip(item.id, item)) changed += 1
  }
  if (changed > 0) {
    const count = (await clips().list()).length
    await publishChanged('clear', { count })
  }
  return { ok: true, changed }
})

brick.onCommand('toggle-favorite', async (_ctx, input) => {
  const id = requireId(input)
  const current = await clips().get(id)
  if (!current) throw new BppError('NOT_FOUND', 'item not found')
  const favorite = typeof input?.favorite === 'boolean' ? input.favorite : !current.favorite
  await clips().update(id, { favorite })
  const count = (await clips().list()).length
  await publishChanged('favorite', { historyItemId: id, count })
  return { favorite }
})

brick.onCommand('storage-info', async () => {
  const dir = await dataDir()
  const items = await clips().list()
  const files = items.filter((item) => typeof item.contentPath === 'string')
  return {
    brickId: BRICK_ID,
    dataDir: dir,
    dbPath: 'brick.storage:clips',
    mediaDir: path.join(dir, 'blobs'),
    directory: dir,
    count: items.length,
    blobCount: files.length,
    blobBytes: files.reduce((total, item) => total + (item.sizeBytes ?? 0), 0),
    maxItems: MAX_ITEMS,
    maxBlobBytes: INLINE_LIMIT
  }
})

brick.onCommand('sync-now', async (ctx) => {
  const capture = await ctx.platform.clipboard.readContent()
  const result = await ingestCapture(capture, 'sync')
  return {
    changed: result.changed,
    reason: 'sync',
    revision,
    item: result.item ? toUiItem(result.item) : undefined
  }
})

brick.onCommand('set-content', async (ctx, input) => {
  const content = input?.content
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new BppError('INVALID_INPUT', 'content must be a clipboard content object')
  }
  const result = await ctx.platform.clipboard.setContent(content)
  try {
    const capture = await ctx.platform.clipboard.readContent()
    await ingestCapture(capture, 'reuse')
  } catch (error) {
    logWarn('set-content history refresh failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
  return result
})

brick.onCommand('runtime-status', async () => {
  const items = await clips().list()
  return {
    state: lastError ? 'error' : 'running',
    enabled: true,
    startedAt,
    uptimeMs: Date.now() - startedAt,
    count: items.length,
    maxItems: MAX_ITEMS,
    processedEvents,
    lastEventAt,
    lastEventKind,
    lastError,
    revision
  }
})

brick.events.on(SOURCE_EVENT, (payload) => {
  void ingestCapture(payload, 'insert').catch((error) => {
    lastError = error instanceof Error ? error.message : String(error)
    logWarn('source event failed', { error: lastError })
  })
})

brick.onReady(() => logInfo('ready · clipboard history ingest connected', { startedAt }))
brick.onShutdown(() => logInfo('shutdown'))
brick.start()
