/* eslint-disable */
'use strict'

const os = require('node:os')
const path = require('node:path')
const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')
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

async function getResource(resourceId) {
  if (!resourceId) return null
  try {
    return await brick.transport.hostCall({
      type: 'host.resource.get',
      resourceId
    })
  } catch (error) {
    history.recordError(error)
    log(`resource.get failed: ${errorMessage(error)}`)
    return null
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
  const payload = snapshot && typeof snapshot === 'object' ? snapshot : {}
  return ingestClipboard(
    payload,
    {
      event: 'clipboard:sync-now',
      sourceBrickId: 'system',
      publishedAt: payload.capturedAt || Date.now()
    },
    payload.resource,
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

brick.events.on(SOURCE_EVENT, async (payload, envelope) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const resource = await getResource(safePayload.resourceId)
  return ingestClipboard(safePayload, envelope, resource, 'insert')
})

brick.onReady(() => {
  log(`ready · loaded ${history.storageInfo().count} items from ${DB_PATH}`)
})

brick.onShutdown(() => {})

brick.start()
