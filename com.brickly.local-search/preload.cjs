const { contextBridge, ipcRenderer } = require('electron')

const BRICK_ID = 'com.brickly.local-search'
const BRICK_ID_FLAG = '--brickly-brick-id='
const INSTANCE_ID_FLAG = '--brickly-instance-id='

const WINDOW_BRICK_ID =
  (process.argv.find((item) => item.startsWith(BRICK_ID_FLAG)) || '').slice(BRICK_ID_FLAG.length) ||
  BRICK_ID
const INSTANCE_ID =
  (process.argv.find((item) => item.startsWith(INSTANCE_ID_FLAG)) || '').slice(INSTANCE_ID_FLAG.length) ||
  undefined

async function invoke(commandId, input = {}) {
  if (INSTANCE_ID) {
    return ipcRenderer.invoke('bricks.invokeInstance', INSTANCE_ID, commandId, input)
  }
  return ipcRenderer.invoke('bridge.invoke', BRICK_ID, commandId, input, {
    brickId: BRICK_ID,
    sessionId: `brick-ui:${WINDOW_BRICK_ID}`
  })
}

async function unwrapSystemResult(promise) {
  const result = await promise
  if (!result || result.ok !== false) {
    return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result
  }
  const error = new Error(result.error?.message || '系统能力调用失败')
  error.code = result.error?.code
  error.details = result.error?.details
  throw error
}

contextBridge.exposeInMainWorld('localSearch', {
  search(input) {
    return invoke('search', input || {})
  },
  health() {
    return invoke('health', {})
  },
  preview(input) {
    return invoke('preview', input || {})
  },
  getFileIcon(path) {
    return ipcRenderer.invoke('platform.app.getFileIcon', path)
  },
  openPath(path) {
    return unwrapSystemResult(ipcRenderer.invoke('platform.system.shellOpenPath', path))
  },
  showInFolder(path) {
    return unwrapSystemResult(ipcRenderer.invoke('platform.system.shellShowItemInFolder', path))
  },
  copyText(text) {
    return ipcRenderer.invoke('platform.clipboard.setContent', {
      kind: 'text',
      text: String(text || '')
    })
  }
})
