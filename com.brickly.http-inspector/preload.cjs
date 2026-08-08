const { contextBridge, ipcRenderer } = require('electron')

const BRICK_ID = 'com.brickly.http-inspector'
const CHANGE_EVENT = 'http-inspector:changed'
const instanceArg = process.argv.find((value) => value.startsWith('--brickly-instance-id='))
const instanceId = instanceArg ? instanceArg.slice('--brickly-instance-id='.length) : undefined
const domainArg = process.argv.find((value) => value.startsWith('--brickly-brick-domain='))
const brickDomain = domainArg ? domainArg.slice('--brickly-brick-domain='.length) : undefined
const subscribers = new Set()

async function invoke(commandId, input = {}) {
  if (instanceId) return ipcRenderer.invoke('bricks.invokeInstance', instanceId, commandId, input)

  const startService = () => ipcRenderer.invoke(
    'platform.startService',
    BRICK_ID,
    brickDomain ? { domain: brickDomain } : undefined
  )
  const reloadCatalog = () => ipcRenderer.invoke('platform.reloadBricks', {
    domain: brickDomain || 'installed'
  })
  const invokeBridge = () => ipcRenderer.invoke(
    'bridge.invoke',
    BRICK_ID,
    commandId,
    input,
    { brickId: BRICK_ID, sessionId: `brick-ui:${BRICK_ID}` },
    undefined,
    brickDomain
  )

  try {
    await startService()
    return await invokeBridge()
  } catch (error) {
    if (error?.code !== 'BRICK_NOT_FOUND') throw error
    await reloadCatalog()
    await startService()
    return invokeBridge()
  }
}

ipcRenderer.on('platform.event.notify', (_event, envelope) => {
  if (envelope?.event !== CHANGE_EVENT) return
  for (const subscriber of subscribers) subscriber(envelope.payload || {})
})
ipcRenderer.invoke('platform.event.subscribe', { brickId: BRICK_ID, event: CHANGE_EVENT }).catch(() => {})

contextBridge.exposeInMainWorld('httpInspector', {
  invoke,
  subscribe(callback) {
    subscribers.add(callback)
    return () => subscribers.delete(callback)
  }
})
