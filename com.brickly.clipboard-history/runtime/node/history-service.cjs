'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_ITEMS = 500
const DEFAULT_MIN_INSERT_INTERVAL_MS = 50

function createHistoryService(options) {
  const {
    dataDir,
    mediaDir,
    dbPath,
    log = () => {},
    now = Date.now,
    maxItems = DEFAULT_MAX_ITEMS,
    minInsertIntervalMs = DEFAULT_MIN_INSERT_INTERVAL_MS
  } = options
  const startedAt = now()
  let lastError
  let state = loadState()
  let lastContentHash = state.items[0]?.contentHash || null
  let lastInsertAt = 0
  let dedupeHits = 0
  let revision = 0
  let processedEvents = 0
  let lastEventAt
  let lastEventKind

  function ensureDir() {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(mediaDir, { recursive: true })
  }

  function loadState() {
    try {
      ensureDir()
      if (!fs.existsSync(dbPath)) return { items: [] }
      const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
      return { items: Array.isArray(parsed.items) ? parsed.items : [] }
    } catch (error) {
      lastError = errorMessage(error)
      log(`load failed: ${lastError}`)
      return { items: [] }
    }
  }

  function commitItems(items) {
    ensureDir()
    try {
      fs.writeFileSync(
        dbPath,
        JSON.stringify({ items: items.slice(0, maxItems) }, null, 2) + '\n',
        'utf8'
      )
      state = { items }
      lastError = undefined
    } catch (error) {
      lastError = errorMessage(error)
      throw error
    }
  }

  function list(limit = maxItems) {
    const cap = Math.max(1, Math.min(Number(limit) || maxItems, maxItems * 4))
    return state.items.slice(0, cap).map((item, index) => ({ ...item, index: index + 1 }))
  }

  function ingest(payload, envelope, resource) {
    const safePayload = payload && typeof payload === 'object' ? payload : {}
    const safeEnvelope = envelope && typeof envelope === 'object' ? envelope : {}
    processedEvents++
    lastEventAt = safeEnvelope.publishedAt || safePayload.capturedAt || now()

    if (!hasClipboardContent(safePayload, resource)) {
      lastEventKind = undefined
      lastError = undefined
      return unchanged('insert')
    }

    try {
      const kind = normalizeKind(safePayload, resource)
      lastEventKind = kind
      const contentHash = computeContentHash(safePayload, resource, kind)
      if (contentHash === lastContentHash) {
        dedupeHits++
        lastError = undefined
        return unchanged('insert')
      }

      const insertedAt = now()
      if (insertedAt - lastInsertAt < minInsertIntervalMs) {
        dedupeHits++
        lastError = undefined
        return unchanged('insert')
      }

      const item = buildItem(safePayload, safeEnvelope, resource, kind, contentHash)
      const top = state.items[0]
      if (top && top.id === item.id && top.contentHash === contentHash) {
        dedupeHits++
        lastError = undefined
        return unchanged('insert')
      }

      const nextItems = [item, ...state.items.filter((oldItem) => oldItem.id !== item.id)].slice(
        0,
        maxItems
      )
      commitItems(nextItems)
      lastContentHash = contentHash
      lastInsertAt = insertedAt
      return changed('insert', { item })
    } catch (error) {
      lastError = errorMessage(error)
      throw error
    }
  }

  function remove(id) {
    const nextItems = state.items.filter((item) => item.id !== id)
    if (nextItems.length === state.items.length) return unchanged('remove')
    commitItems(nextItems)
    lastContentHash = state.items[0]?.contentHash || null
    return changed('remove')
  }

  function clear(keepFavorites) {
    const next = keepFavorites ? state.items.filter((item) => item.favorite) : []
    if (next.length === state.items.length) return unchanged('clear')
    commitItems(next)
    lastContentHash = state.items[0]?.contentHash || null
    return changed('clear')
  }

  function toggleFavorite(id) {
    const itemIndex = state.items.findIndex((entry) => entry.id === id)
    const item = state.items[itemIndex]
    if (!item) return { ...unchanged('favorite'), found: false }
    const favorite = !item.favorite
    const nextItems = state.items.slice()
    nextItems[itemIndex] = { ...item, favorite }
    commitItems(nextItems)
    return changed('favorite', { found: true, favorite })
  }

  function storageInfo() {
    return {
      brickId: 'com.brickly.clipboard-history',
      dataDir,
      mediaDir,
      dbPath,
      count: state.items.length,
      maxItems,
      dedupeHits
    }
  }

  function status() {
    return {
      state: 'running',
      enabled: true,
      startedAt,
      uptimeMs: Math.max(0, now() - startedAt),
      count: state.items.length,
      maxItems,
      dedupeHits,
      processedEvents,
      lastEventAt,
      lastEventKind,
      lastError,
      revision
    }
  }

  function recordError(error) {
    lastError = errorMessage(error)
  }

  function changed(reason, extra = {}) {
    revision++
    return {
      changed: true,
      reason,
      revision,
      count: state.items.length,
      at: now(),
      ...extra
    }
  }

  function unchanged(reason) {
    return {
      changed: false,
      reason,
      revision,
      count: state.items.length,
      at: now()
    }
  }

  function buildItem(payload, envelope, resource, kind, contentHash) {
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

    return {
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
      createdAt: envelope.publishedAt || payload.capturedAt || now(),
      favorite: old?.favorite || false
    }
  }

  function persistImageFile(sourcePath, id, preferredName) {
    if (typeof sourcePath !== 'string' || !sourcePath) return undefined
    try {
      if (!fs.existsSync(sourcePath)) return undefined
      ensureDir()
      const ext = imageExtension(preferredName || sourcePath)
      const target = path.join(mediaDir, `${sanitizeFileName(id)}${ext}`)
      if (path.resolve(sourcePath).toLowerCase() !== path.resolve(target).toLowerCase()) {
        fs.copyFileSync(sourcePath, target)
      }
      return target
    } catch (error) {
      log(`persist image failed: ${errorMessage(error)}`)
      return sourcePath
    }
  }

  return {
    list,
    ingest,
    remove,
    clear,
    toggleFavorite,
    storageInfo,
    status,
    recordError
  }
}

function hasClipboardContent(payload, resource) {
  if (payload.kind === 'text' || payload.kind === 'image' || payload.kind === 'file') return true
  if (typeof payload.hash === 'string' && payload.hash) return true
  if (typeof payload.text === 'string' || typeof payload.textPreview === 'string') return true
  if (typeof payload.path === 'string' && payload.path) return true
  if (Array.isArray(payload.paths) && payload.paths.some((item) => typeof item === 'string' && item)) {
    return true
  }
  if (typeof resource?.filePath === 'string' && resource.filePath) return true
  return typeof resource?.content?.text === 'string'
}

function normalizeKind(payload, resource) {
  const pathCount = Array.isArray(payload.paths)
    ? payload.paths.filter((item) => typeof item === 'string' && item).length
    : 0
  if (payload.sourceType === 'file-list' || pathCount > 0) return 'file'
  if (payload.sourceType === 'text') return 'text'
  if (payload.kind === 'image' || payload.kind === 'file' || payload.kind === 'text') {
    return payload.kind
  }

  const mime = String(payload.mimeType || resource?.mimeType || '')
  if (mime.startsWith('image/')) return 'image'
  if (typeof payload.path === 'string' && payload.path) return 'file'
  return 'text'
}

function computeContentHash(payload, resource, kind) {
  const content = (resource && resource.content) || {}
  const hash = crypto.createHash('sha1')
  hash.update(kind)
  hash.update('\u0001')
  if (kind === 'image') {
    const imagePath = payload.imagePath || resource?.filePath || payload.path || ''
    hash.update(safeFileHash(imagePath) || String(payload.hash || ''))
    hash.update('\u0001')
    hash.update(String(payload.size || resource?.size || 0))
    hash.update('\u0001')
    hash.update(`${payload.width || 0}x${payload.height || 0}`)
  } else if (kind === 'file') {
    hash.update(String(payload.path || ''))
    hash.update('\u0001')
    hash.update(JSON.stringify(payload.paths || []))
  } else {
    const text =
      typeof content.text === 'string'
        ? content.text
        : typeof payload.text === 'string'
          ? payload.text
          : typeof payload.textPreview === 'string'
            ? payload.textPreview
            : ''
    hash.update(text)
  }
  return hash.digest('hex')
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
    const hash = crypto.createHash('sha1')
    hash.update(fs.readFileSync(filePath))
    return hash.digest('hex')
  } catch {}
  return ''
}

function buildImagePreview(payload, resource, sourcePath) {
  const bits = []
  if (payload.width && payload.height) bits.push(`${payload.width} × ${payload.height}`)
  if (payload.textPreview) bits.push(payload.textPreview)
  if (sourcePath) bits.push(sourcePath)
  if (resource?.filePath && resource.filePath !== sourcePath) bits.push(resource.filePath)
  return bits.filter(Boolean).join(' · ')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

module.exports = { createHistoryService }
