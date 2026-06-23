const { contextBridge, ipcRenderer } = require('electron')

/**
 * 剪贴板历史 UI preload。
 *
 * 这个 Brick 自身同时拥有 runtime service 和自定义 UI。preload 只负责把 UI
 * 调用路由到同一个 runtime 实例，并订阅 `clipboard-history:changed` 事件刷新列表。
 */

const BRICK_ID = 'com.brickly.clipboard-history'
const HISTORY_EVENT = 'clipboard-history:changed'
const BRICK_ID_FLAG = '--brickly-brick-id='
const INSTANCE_ID_FLAG = '--brickly-instance-id='

const WINDOW_BRICK_ID =
  (process.argv.find((item) => item.startsWith(BRICK_ID_FLAG)) || '').slice(
    BRICK_ID_FLAG.length
  ) || BRICK_ID
const INSTANCE_ID =
  (process.argv.find((item) => item.startsWith(INSTANCE_ID_FLAG)) || '').slice(
    INSTANCE_ID_FLAG.length
  ) || undefined

const subscribers = new Set()
let lastStorageInfo = null

function emit(event, items) {
  for (const callback of [...subscribers]) {
    try {
      callback(event, items)
    } catch (error) {
      console.warn('[clipboard-history] subscriber error', error)
    }
  }
}

async function invokeHistory(commandId, input = {}) {
  if (INSTANCE_ID) {
    return ipcRenderer.invoke('bricks.invokeInstance', INSTANCE_ID, commandId, input)
  }
  return ipcRenderer.invoke(
    'bridge.invoke',
    BRICK_ID,
    commandId,
    input,
    { brickId: BRICK_ID, sessionId: `brick-ui:${WINDOW_BRICK_ID}` }
  )
}

async function list() {
  try {
    const result = await invokeHistory('list', { limit: 500 })
    return Array.isArray(result?.items) ? result.items : []
  } catch (error) {
    console.warn('[clipboard-history] list failed', error)
    return []
  }
}

async function remove(id) {
  try {
    const result = await invokeHistory('remove', { id })
    return Boolean(result?.ok)
  } catch (error) {
    console.warn('[clipboard-history] remove failed', error)
    return false
  }
}

async function clear(keepFavorites = false) {
  try {
    await invokeHistory('clear', { keepFavorites: Boolean(keepFavorites) })
    return true
  } catch (error) {
    console.warn('[clipboard-history] clear failed', error)
    return false
  }
}

async function toggleFavorite(id) {
  try {
    const result = await invokeHistory('toggle-favorite', { id })
    return Boolean(result?.favorite)
  } catch (error) {
    console.warn('[clipboard-history] toggleFavorite failed', error)
    return false
  }
}

async function refreshStorageInfo() {
  try {
    lastStorageInfo = await invokeHistory('storage-info', {})
  } catch (error) {
    console.warn('[clipboard-history] storage-info failed', error)
  }
  return lastStorageInfo
}

function storageInfo() {
  refreshStorageInfo()
  return lastStorageInfo
}

function subscribe(callback) {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

// 异步预热缓存。
refreshStorageInfo()

// 订阅自身 runtime 发布的 clipboard-history:changed。
// 连续事件合并成一次 list()，避免 UI 侧重复拉取。
let listScheduled = false
let lastListAt = 0
const MIN_LIST_INTERVAL_MS = 100
async function scheduleList() {
  if (listScheduled) return
  const wait = Math.max(0, MIN_LIST_INTERVAL_MS - (Date.now() - lastListAt))
  listScheduled = true
  setTimeout(async () => {
    listScheduled = false
    lastListAt = Date.now()
    const items = await list()
    emit('changed', items)
  }, wait)
}

ipcRenderer.on('platform.event.notify', (_event, envelope) => {
  if (!envelope || envelope.event !== HISTORY_EVENT) return
  void scheduleList()
})

ipcRenderer
  .invoke('platform.event.subscribe', { brickId: BRICK_ID, event: HISTORY_EVENT })
  .catch((error) => console.warn('[clipboard-history] subscribe history event failed', error))

list()
  .then((items) => {
    if (items.length) emit('changed', items)
  })
  .catch(() => {})

contextBridge.exposeInMainWorld('clipboardHistoryStore', {
  list,
  remove,
  clear,
  toggleFavorite,
  storageInfo,
  refreshStorageInfo,
  subscribe
})

contextBridge.exposeInMainWorld('clipboardHistoryPlatform', {
  clipboard: {
    status() {
      return ipcRenderer.invoke('platform.clipboard.status')
    },
    captureNow() {
      return ipcRenderer.invoke('platform.clipboard.captureNow')
    },
    setContent(content) {
      return ipcRenderer.invoke('platform.clipboard.setContent', content)
    }
  },
  app: {
    getFileIcon(path) {
      return ipcRenderer.invoke('platform.app.getFileIcon', path)
    }
  }
})
