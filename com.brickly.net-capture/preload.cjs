const { contextBridge, ipcRenderer } = require('electron')

const BRICK_ID = 'com.brickly.net-capture'
const CHANGE_EVENT = 'net-capture:changed'
const BRICK_ID_FLAG = '--brickly-brick-id='
const INSTANCE_ID_FLAG = '--brickly-instance-id='

const WINDOW_BRICK_ID =
  (process.argv.find((item) => item.startsWith(BRICK_ID_FLAG)) || '').slice(BRICK_ID_FLAG.length) ||
  BRICK_ID
const INSTANCE_ID =
  (process.argv.find((item) => item.startsWith(INSTANCE_ID_FLAG)) || '').slice(INSTANCE_ID_FLAG.length) ||
  undefined

const subscribers = new Set()

async function invoke(commandId, input = {}) {
  if (INSTANCE_ID) {
    return ipcRenderer.invoke('bricks.invokeInstance', INSTANCE_ID, commandId, input)
  }
  return ipcRenderer.invoke('bridge.invoke', BRICK_ID, commandId, input, {
    brickId: BRICK_ID,
    sessionId: `brick-ui:${WINDOW_BRICK_ID}`
  })
}

function emit(event) {
  for (const callback of [...subscribers]) {
    try {
      callback(event)
    } catch (error) {
      console.warn('[net-capture] subscriber failed', error)
    }
  }
}

let scheduled = false
function scheduleChanged(envelope) {
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    scheduled = false
    emit({ type: 'changed', payload: envelope?.payload || {} })
  }, 120)
}

ipcRenderer.on('platform.event.notify', (_event, envelope) => {
  if (!envelope || envelope.event !== CHANGE_EVENT) return
  scheduleChanged(envelope)
})

ipcRenderer
  .invoke('platform.event.subscribe', { brickId: BRICK_ID, event: CHANGE_EVENT })
  .catch((error) => console.warn('[net-capture] subscribe failed', error))

contextBridge.exposeInMainWorld('netCapture', {
  start(options) {
    return invoke('start', options || {})
  },
  stop() {
    return invoke('stop', {})
  },
  status() {
    return invoke('status', {})
  },
  list(input) {
    return invoke('list', input || {})
  },
  detail(id) {
    return invoke('detail', { id })
  },
  clear() {
    return invoke('clear', {})
  },
  installCert() {
    return invoke('install-cert', {})
  },
  setSystemProxy(enabled) {
    return invoke('set-system-proxy', { enabled: Boolean(enabled) })
  },
  subscribe(callback) {
    subscribers.add(callback)
    return () => subscribers.delete(callback)
  }
})
