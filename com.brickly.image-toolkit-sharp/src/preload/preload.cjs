/**
 * 万能图片工具箱 — 自定义 App Preload
 *
 * 安全地桥接 Electron 底层的 webUtils 与 shell 等 API，以提供绝对路径解析和输出文件夹一键打开体验。
 */

const { contextBridge, webUtils, shell } = require('electron')
const path = require('node:path')

contextBridge.exposeInMainWorld('imageToolkitPreload', {
  /**
   * 使用 Electron 32+ webUtils 获取原生 File 对象的磁盘绝对路径
   */
  getPathForFile: (file) => {
    try {
      if (!file) return ''
      return webUtils.getPathForFile(file) || ''
    } catch (error) {
      console.warn('[image-toolkit-sharp] getPathForFile 失败', error)
      return ''
    }
  },

  /**
   * 使用 Electron shell 一键打开指定文件所在的文件夹
   */
  openFolder: async (filePath) => {
    try {
      if (!filePath) return { ok: false, error: '未提供文件路径' }
      const dir = path.dirname(filePath)
      await shell.openPath(dir)
      return { ok: true }
    } catch (error) {
      console.error('[image-toolkit-sharp] 打开文件夹失败', error)
      return { ok: false, error: error.message }
    }
  },

  /**
   * 通用路径工具函数
   */
  joinPaths: (...args) => path.join(...args),
  getDirname: (filePath) => path.dirname(filePath),
  getBasename: (filePath, ext) => path.basename(filePath, ext)
})

console.info('[image-toolkit-sharp][preload] window.imageToolkitPreload 就绪')
