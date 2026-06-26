/* eslint-disable */
'use strict'

/**
 * 剪贴板历史 Brick runtime。
 *
 * 单个 Brick 同时承担 service 订阅者和 UI 后端能力：
 *   1. 订阅宿主发布的 clipboard:new-content 事件
 *   2. 拉取宿主资源，去重，落盘 history.json 与 media/
 *   3. 暴露 list/remove/clear/toggle-favorite/storage-info 命令给自定义 UI
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.clipboard-history'
const HISTORY_EVENT = 'clipboard-history:changed'
const SOURCE_EVENT = 'clipboard:new-content'

const DATA_DIR = path.join(os.homedir(), '.brickly', 'apps', BRICK_ID)
const MEDIA_DIR = path.join(DATA_DIR, 'media')
const DB_PATH = path.join(DATA_DIR, 'history.json')
const MAX_ITEMS = 500
const MIN_INSERT_INTERVAL_MS = 50

const brick = new BricklyRuntime({ brickId: BRICK_ID })

let state = loadState()
let lastContentHash = state.items[0]?.contentHash || null
let lastInsertAt = 0
let dedupeHits = 0
let notifyTimer = null

function log(message) {
  brick.log.info(message)
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
}

function loadState() {
  try {
    ensureDir()
    if (!fs.existsSync(DB_PATH)) return { items: [] }
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
    return { items: Array.isArray(parsed.items) ? parsed.items : [] }
  } catch (error) {
    process.stderr.write(`[${BRICK_ID}] load failed: ${error?.message || error}\n`)
    return { items: [] }
  }
}

function saveState() {
  ensureDir()
  fs.writeFileSync(
    DB_PATH,
    JSON.stringify({ items: state.items.slice(0, MAX_ITEMS) }, null, 2) + '\n',
    'utf8'
  )
}

function listItems(limit = MAX_ITEMS) {
  const cap = Math.max(1, Math.min(Number(limit) || MAX_ITEMS, MAX_ITEMS * 4))
  return state.items.slice(0, cap).map((item, index) => ({ ...item, index: index + 1 }))
}

function notifyChanged() {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    brick.events.publish(HISTORY_EVENT, { count: state.items.length, at: Date.now() }).catch(
      (error) => {
        log(`publish ${HISTORY_EVENT} failed: ${error?.message || error}`)
      }
    )
  }, 60)
  notifyTimer.unref?.()
}

function normalizeKind(payload, resource) {
  const pathCount = Array.isArray(payload.paths)
    ? payload.paths.filter((item) => typeof item === 'string' && item).length
    : 0
  if (payload.sourceType === 'file-list' && pathCount > 1) return 'file'
  if (pathCount > 1) return 'file'
  if (payload.sourceType === 'text') return 'text'
  if (payload.kind === 'image') return 'image'
  if (payload.kind === 'file') return 'file'
  if (payload.kind === 'text') return 'text'

  const mime = String(payload.mimeType || resource?.mimeType || '')
  if (mime.startsWith('image/')) return 'image'

  if (payload.sourceType === 'file-list') return 'file'
  if (Array.isArray(payload.paths) && payload.paths.length > 0) return 'file'

  const hasText =
    typeof resource?.content?.text === 'string' ||
    typeof payload.text === 'string' ||
    typeof payload.textPreview === 'string'
  if (hasText) return 'text'

  if (typeof payload.path === 'string' && payload.path) return 'file'

  return 'text'
}

function computeContentHash(payload, resource, kind) {
  const content = (resource && resource.content) || {}
  const h = crypto.createHash('sha1')
  h.update(kind)
  h.update('\u0001')
  if (kind === 'image') {
    const imagePath = payload.imagePath || resource?.filePath || payload.path || ''
    const fileHash = safeFileHash(imagePath)
    h.update(fileHash || String(payload.hash || ''))
    h.update('\u0001')
    h.update(String(payload.size || resource?.size || 0))
    h.update('\u0001')
    h.update(`${payload.width || 0}x${payload.height || 0}`)
  } else if (kind === 'file') {
    h.update(String(payload.path || ''))
    h.update('\u0001')
    h.update(JSON.stringify(payload.paths || []))
  } else {
    const text =
      typeof content.text === 'string'
        ? content.text
        : typeof payload.text === 'string'
          ? payload.text
          : typeof payload.textPreview === 'string'
            ? payload.textPreview
            : ''
    h.update(text)
  }
  return h.digest('hex')
}

function imageExtension(value) {
  const ext = path.extname(String(value || '')).toLowerCase()
  if (/^\.(png|jpg|jpeg|gif|webp|bmp|ico|svg|avif)$/.test(ext)) return ext
  return '.png'
}

function sanitizeFileName(value) {
  const cleaned = String(value || crypto.randomUUID())
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .slice(0, 160)
  return cleaned || crypto.randomUUID()
}

function safeFileSize(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) return fs.statSync(filePath).size
  } catch {}
  return 0
}

function safeFileHash(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return ''
    const h = crypto.createHash('sha1')
    h.update(fs.readFileSync(filePath))
    return h.digest('hex')
  } catch {}
  return ''
}

function persistImageFile(sourcePath, id, preferredName) {
  if (typeof sourcePath !== 'string' || !sourcePath) return undefined
  try {
    if (!fs.existsSync(sourcePath)) return undefined
    ensureDir()
    const ext = imageExtension(preferredName || sourcePath)
    const target = path.join(MEDIA_DIR, `${sanitizeFileName(id)}${ext}`)
    if (path.resolve(sourcePath).toLowerCase() !== path.resolve(target).toLowerCase()) {
      fs.copyFileSync(sourcePath, target)
    }
    return target
  } catch (error) {
    log(`persist image failed: ${error?.message || error}`)
    return sourcePath
  }
}

function buildImagePreview(payload, resource, sourcePath) {
  const bits = []
  if (payload.width && payload.height) bits.push(`${payload.width} × ${payload.height}`)
  if (payload.textPreview) bits.push(payload.textPreview)
  if (sourcePath) bits.push(sourcePath)
  if (resource?.filePath && resource.filePath !== sourcePath) bits.push(resource.filePath)
  return bits.filter(Boolean).join(' · ')
}

function upsertFromEvent(envelope, resource, kind, contentHash) {
  const payload = envelope.payload || {}
  const content = (resource && resource.content) || {}
  const resourceFilePath = typeof resource?.filePath === 'string' ? resource.filePath : ''
  const text =
    typeof content.text === 'string'
      ? content.text
      : typeof payload.text === 'string'
        ? payload.text
        : typeof payload.textPreview === 'string'
          ? payload.textPreview
          : ''
  const id = `clip_${contentHash.slice(0, 16)}`
  const old = state.items.find((item) => item.id === id)
  const imagePath =
    kind === 'image'
      ? persistImageFile(
          resourceFilePath || payload.imagePath || payload.path,
          id,
          payload.name || resource?.name
        )
      : undefined
  const paths = Array.isArray(payload.paths)
    ? payload.paths.filter((item) => typeof item === 'string')
    : undefined
  const filePaths =
    paths && paths.length > 0
      ? paths
      : typeof payload.path === 'string' && payload.path
        ? [payload.path]
        : []

  let title
  let preview
  if (kind === 'image') {
    title =
      payload.name ||
      resource?.name ||
      path.basename(imagePath || payload.path || resourceFilePath || '') ||
      '剪贴板图片'
    preview = buildImagePreview(payload, resource, imagePath || resourceFilePath || payload.path)
  } else if (kind === 'file') {
    title = filePaths.length > 1 ? `${filePaths.length} 个文件` : filePaths[0] || '文件'
    preview = filePaths.join('\n')
  } else {
    title = text.split(/\r?\n/).find(Boolean)?.slice(0, 120) || '(空文本)'
    preview = text.slice(0, 2000) || payload.textPreview || ''
  }

  const item = {
    id,
    type: kind,
    mimeType:
      payload.mimeType || resource?.mimeType || (kind === 'image' ? 'image/*' : 'text/plain'),
    text: kind === 'text' ? text : '',
    title,
    preview,
    path: typeof payload.path === 'string' && payload.path ? payload.path : filePaths[0],
    paths: filePaths.length > 0 ? filePaths : paths,
    imagePath,
    imageOriginalPath: kind === 'image' ? payload.path || resourceFilePath || undefined : undefined,
    width: payload.width,
    height: payload.height,
    size:
      payload.size ||
      resource?.size ||
      safeFileSize(imagePath || resourceFilePath) ||
      Buffer.byteLength(text || '', 'utf8'),
    sourceBrickId: envelope.sourceBrickId,
    event: envelope.event,
    resourceId: payload.resourceId,
    contentHash,
    createdAt: envelope.publishedAt || Date.now(),
    favorite: old?.favorite || false
  }

  const top = state.items[0]
  if (top && top.id === id && top.contentHash === contentHash) {
    return null
  }

  state.items = [item, ...state.items.filter((oldItem) => oldItem.id !== id)].slice(0, MAX_ITEMS)
  saveState()
  return item
}

function removeItem(id) {
  const before = state.items.length
  state.items = state.items.filter((item) => item.id !== id)
  if (state.items.length === before) return false
  saveState()
  return true
}

function clearItems(keepFavorites) {
  state.items = keepFavorites ? state.items.filter((item) => item.favorite) : []
  saveState()
  return true
}

function toggleFavorite(id) {
  const item = state.items.find((entry) => entry.id === id)
  if (!item) return null
  item.favorite = !item.favorite
  saveState()
  return item.favorite
}

function storageInfo() {
  return {
    brickId: BRICK_ID,
    dataDir: DATA_DIR,
    mediaDir: MEDIA_DIR,
    dbPath: DB_PATH,
    count: state.items.length,
    maxItems: MAX_ITEMS,
    dedupeHits
  }
}

async function getResource(resourceId) {
  if (!resourceId) return null
  try {
    return await brick.transport.hostCall({
      type: 'host.resource.get',
      resourceId
    })
  } catch (error) {
    log(`resource.get failed: ${error?.message || error}`)
    return null
  }
}

async function onClipboardEvent(payload, envelope) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  let resource = null
  let kind = normalizeKind(safePayload, null)
  let earlyHash
  try {
    earlyHash = computeContentHash(safePayload, null, kind)
  } catch {}
  if (earlyHash && earlyHash === lastContentHash) {
    dedupeHits++
    return
  }

  resource = await getResource(safePayload.resourceId)
  kind = normalizeKind(safePayload, resource)
  const contentHash = computeContentHash(safePayload, resource, kind)
  if (contentHash === lastContentHash) {
    dedupeHits++
    return
  }

  const now = Date.now()
  if (now - lastInsertAt < MIN_INSERT_INTERVAL_MS) {
    dedupeHits++
    return
  }

  try {
    const inserted = upsertFromEvent(
      {
        event: envelope.event,
        payload: safePayload,
        sourceBrickId: envelope.sourceBrickId,
        publishedAt: envelope.publishedAt
      },
      resource,
      kind,
      contentHash
    )
    if (inserted) {
      lastContentHash = contentHash
      lastInsertAt = now
      log(`insert: ${kind} hash=${contentHash.slice(0, 8)}… size=${inserted.size}`)
      notifyChanged()
    }
  } catch (error) {
    log(`upsert failed: ${error?.message || error}`)
  }
}

brick.onCommand('list', (_ctx, input) => {
  return { items: listItems(input?.limit) }
})

brick.onCommand('remove', (_ctx, input) => {
  const ok = removeItem(String(input?.id || ''))
  if (ok) notifyChanged()
  return { ok }
})

brick.onCommand('clear', (_ctx, input) => {
  clearItems(Boolean(input?.keepFavorites))
  lastContentHash = null
  notifyChanged()
  return { ok: true }
})

brick.onCommand('toggle-favorite', (_ctx, input) => {
  const favorite = toggleFavorite(String(input?.id || ''))
  if (favorite === null) throw new BppError('NOT_FOUND', 'item not found')
  notifyChanged()
  return { favorite }
})

brick.onCommand('storage-info', () => storageInfo())

brick.events.on(SOURCE_EVENT, (payload, envelope) => {
  void onClipboardEvent(payload, envelope)
})

brick.onReady(() => {
  log(`ready · loaded ${state.items.length} items from ${DB_PATH}`)
})

brick.onShutdown(() => {
  if (notifyTimer) clearTimeout(notifyTimer)
})

brick.start()
