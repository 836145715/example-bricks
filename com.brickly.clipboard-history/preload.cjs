const { contextBridge, ipcRenderer } = require('electron')

const SOURCE_BRICK_ID = 'com.brickly.clipboard-history'
const HISTORY_EVENT = 'clipboard-history:changed'
const MAX_SUBSCRIBE_ATTEMPTS = 8

const listeners = new Set()
let hostSubscribed = false
let hostSubscribePromise = null

ipcRenderer.on('platform.event.notify', (_event, envelope) => {
  if (envelope?.event !== HISTORY_EVENT || envelope?.sourceBrickId !== SOURCE_BRICK_ID) return
  for (const listener of [...listeners]) {
    try {
      listener(envelope)
    } catch (error) {
      console.warn('[clipboard-history] event listener failed', error)
    }
  }
})

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function subscribeHostWithRetry() {
  for (let attempt = 0; attempt < MAX_SUBSCRIBE_ATTEMPTS; attempt++) {
    try {
      await ipcRenderer.invoke('platform.event.subscribe', { event: HISTORY_EVENT })
      hostSubscribed = true
      return
    } catch (error) {
      if (attempt + 1 >= MAX_SUBSCRIBE_ATTEMPTS) throw error
      await wait(Math.min(1000, 120 * (attempt + 1)))
    }
  }
}

function ensureHostSubscription() {
  if (hostSubscribed) return Promise.resolve()
  if (!hostSubscribePromise) {
    hostSubscribePromise = subscribeHostWithRetry().finally(() => {
      hostSubscribePromise = null
    })
  }
  return hostSubscribePromise
}

async function unsubscribeHost() {
  if (hostSubscribePromise) {
    try {
      await hostSubscribePromise
    } catch {
      return
    }
  }
  if (!hostSubscribed) return
  hostSubscribed = false
  await ipcRenderer.invoke('platform.event.unsubscribe', { event: HISTORY_EVENT })
}

async function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener 必须是函数')
  listeners.add(listener)
  try {
    await ensureHostSubscription()
  } catch (error) {
    listeners.delete(listener)
    throw error
  }

  let active = true
  return async () => {
    if (!active) return
    active = false
    listeners.delete(listener)
    if (listeners.size === 0) await unsubscribeHost()
  }
}

contextBridge.exposeInMainWorld('clipboardHistoryEvents', { subscribe })
