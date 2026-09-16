'use strict'

const { ipcRenderer } = require('electron')

const api = Object.freeze({
  pickFile(options) {
    return ipcRenderer.invoke('fs.pickFile', options)
  },
  pickSavePath(options) {
    return ipcRenderer.invoke('fs.pickSavePath', options)
  },
  pickDirectory(options) {
    return ipcRenderer.invoke('fs.pickDirectory', options)
  },
})

if (globalThis.bricklyPreload && typeof globalThis.bricklyPreload.exposeApi === 'function') {
  globalThis.bricklyPreload.exposeApi('sunnyNetFs', api)
}
