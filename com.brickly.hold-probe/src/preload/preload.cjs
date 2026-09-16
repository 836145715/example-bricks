'use strict'

const { ipcRenderer, webUtils } = require('electron')

const api = Object.freeze({
  pickFile() {
    return ipcRenderer.invoke('fs.pickFile')
  },
  pickDirectory() {
    return ipcRenderer.invoke('fs.pickDirectory')
  },
  getPathForFile(file) {
    if (!file) return ''
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
})

globalThis.bricklyPreload.exposeApi('holdProbePreload', api)
