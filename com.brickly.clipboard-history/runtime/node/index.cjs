/* eslint-disable */
'use strict'

const os = require('node:os')
const path = require('node:path')
const { BricklyRuntime, BppError, ResourceHandle } = require('@syllm/brickly-sdk')
const { createHistoryService } = require('./history-service.cjs')

const BRICK_ID = 'com.brickly.clipboard-history'
const HISTORY_EVENT = 'clipboard-history:changed'
const SOURCE_EVENT = 'clipboard:new-content'
const DATA_DIR = path.join(os.homedir(), '.brickly', 'apps', BRICK_ID)
const MEDIA_DIR = path.join(DATA_DIR, 'media')
const DB_PATH = path.join(DATA_DIR, 'history.json')

const brick = new BricklyRuntime({ brickId: BRICK_ID })
const history = createHistoryService({
  dataDir: DATA_DIR,
  mediaDir: MEDIA_DIR,
  dbPath: DB_PATH,
  log
})

function log(message) {
  brick.log.info(message)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function isResourceRef(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.kind === 'brickly.resource' &&
      typeof value.resourceId === 'string' &&
      typeof value.accessToken === 'string'
  )
}

function asResourceHandle(value) {
  if (value instanceof ResourceHandle) return value
  return isResourceRef(value) ? new ResourceHandle(brick.transport, value) : undefined
}

function resourceExtension(resource) {
  const name = resource?.ref?.name || ''
  const byName = path.extname(String(name)).toLowerCase()
  if (/^\.[a-z0-9]{1,8}$/.test(byName)) return byName
  const mime = String(resource?.ref?.mimeType || '')
  const byMime = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  }[mime]
  return byMime || '.bin'
}

async function materializeClipboardPayload(value) {
  const outer = asResourceHandle(value)
  const raw = outer ? await outer.json() : value
  const payload = raw && typeof raw === 'object' ? { ...raw } : {}
  const resource = asResourceHandle(payload.resource)
  if (!resource) return { payload, resource: undefined }

  const metadata = resource.ref || {}
  const mimeType = payload.mimeType || metadata.mimeType
  if (String(mimeType || '').startsWith('text/') || payload.kind === 'text') {
    payload.text = await resource.text()
    return {
      payload,
      resource: {
        mimeType,
        name: metadata.name,
        size: metadata.sizeBytes,
        content: { text: payload.text }
      }
    }
  }

  const target = path.join(
    MEDIA_DIR,
    `.incoming-${Date.now()}-${Math.random().toString(36).slice(2)}${resourceExtension(resource)}`
  )
  await resource.saveTo(target)
  payload.path = target
  if (payload.kind === 'image' || String(mimeType || '').startsWith('image/')) {
    payload.imagePath = target
  } else {
    payload.paths = [target]
  }
  return {
    payload,
    resource: {
      mimeType,
      name: metadata.name,
      size: metadata.sizeBytes,
      filePath: target
    }
  }
}

async function publishMutation(mutation, reason = mutation.reason) {
  const result = {
    changed: mutation.changed,
    reason,
    revision: mutation.revision,
    count: mutation.count
  }
  if (!mutation.changed) return result

  try {
    await brick.events.publish(HISTORY_EVENT, {
      revision: mutation.revision,
      count: mutation.count,
      reason,
      at: Date.now()
    })
  } catch (error) {
    history.recordError(error)
    log(`publish ${HISTORY_EVENT} failed: ${errorMessage(error)}`)
  }
  return result
}

async function ingestClipboard(payload, envelope, resource, reason) {
  try {
    const mutation = history.ingest(payload, envelope, resource)
    if (mutation.changed) {
      const item = mutation.item
      log(`insert: ${item.type} hash=${item.contentHash.slice(0, 8)}… size=${item.size}`)
    }
    return await publishMutation(mutation, reason)
  } catch (error) {
    history.recordError(error)
    log(`upsert failed: ${errorMessage(error)}`)
    throw error
  }
}

async function handleClipboardEvent(payload, envelope) {
  const materialized = await materializeClipboardPayload(payload)
  return ingestClipboard(materialized.payload, envelope, materialized.resource, 'insert')
}

brick.onCommand('list', (_ctx, input) => {
  return { items: history.list(input?.limit) }
})

brick.onCommand('remove', async (_ctx, input) => {
  const mutation = history.remove(String(input?.id || ''))
  await publishMutation(mutation)
  return { ok: mutation.changed }
})

brick.onCommand('clear', async (_ctx, input) => {
  const mutation = history.clear(Boolean(input?.keepFavorites))
  await publishMutation(mutation)
  return { ok: true, changed: mutation.changed }
})

brick.onCommand('toggle-favorite', async (_ctx, input) => {
  const mutation = history.toggleFavorite(String(input?.id || ''))
  if (!mutation.found) throw new BppError('NOT_FOUND', 'item not found')
  await publishMutation(mutation)
  return { favorite: mutation.favorite }
})

brick.onCommand('storage-info', () => history.storageInfo())

brick.onCommand('sync-now', async (ctx) => {
  const snapshot = await ctx.platform.clipboard.readContent()
  const materialized = await materializeClipboardPayload(snapshot)
  const payload = materialized.payload
  return ingestClipboard(
    payload,
    {
      event: 'clipboard:sync-now',
      sourceBrickId: 'system',
      publishedAt: payload.capturedAt || Date.now()
    },
    materialized.resource,
    'sync'
  )
})

brick.onCommand('set-content', async (ctx, input) => {
  const content = input?.content
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new BppError('INVALID_INPUT', 'content must be a clipboard content object')
  }
  return ctx.platform.clipboard.setContent(content)
})

brick.onCommand('runtime-status', () => history.status())

brick.events.on(SOURCE_EVENT, (payload, envelope) => {
  void handleClipboardEvent(payload, envelope).catch((error) => {
    history.recordError(error)
    log(`clipboard event failed: ${errorMessage(error)}`)
  })
})

brick.onReady(() => {
  log(`ready · loaded ${history.storageInfo().count} items from ${DB_PATH}`)
})

brick.onShutdown(() => {})

brick.start()
