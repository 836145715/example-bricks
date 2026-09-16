/**
 * 二维码工具 — 自定义 App Preload
 *
 * 剪贴板写入走宿主 platform.clipboard（与 clipboard-history 一致），
 * 对应 SDK：runtime 侧 ctx.platform.clipboard.setContent / UI 侧 IPC。
 */

const { contextBridge, webUtils, shell, clipboard, nativeImage, ipcRenderer } =
  require('electron')
const path = require('node:path')

contextBridge.exposeInMainWorld('qrToolkitPreload', {
  getPathForFile: (file) => {
    try {
      if (!file) return ''
      return webUtils.getPathForFile(file) || ''
    } catch (error) {
      console.warn('[qr-toolkit] getPathForFile 失败', error)
      return ''
    }
  },

  openFolder: async (filePath) => {
    try {
      if (!filePath) return { ok: false, error: '未提供文件路径' }
      const dir = path.dirname(filePath)
      await shell.openPath(dir)
      return { ok: true }
    } catch (error) {
      console.error('[qr-toolkit] 打开文件夹失败', error)
      return { ok: false, error: error.message }
    }
  },

  /**
   * 写入系统剪贴板图片（位图，非 base64 文本）
   * 优先 platform.clipboard.setContent({ kind: 'image', dataUrl })
   * @param {string} dataUrl
   */
  copyImageDataUrl: async (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
      return { ok: false, error: '无效图片数据' }
    }

    // 1) 宿主 platform API（正式路径，需 manifest permissions: os.clipboard）
    try {
      const result = await ipcRenderer.invoke('platform.clipboard.setContent', {
        kind: 'image',
        dataUrl,
      })
      // 成功时一般返回 { kind, formats, updatedAt, ... }
      if (result && result.ok === false) {
        throw new Error(result.error || result.message || 'platform 写入失败')
      }
      if (result && (result.kind === 'image' || Array.isArray(result.formats))) {
        return { ok: true, method: 'platform.clipboard.setContent', result }
      }
      // 部分实现只返回空对象/void，视为成功
      return { ok: true, method: 'platform.clipboard.setContent', result }
    } catch (error) {
      console.warn('[qr-toolkit] platform.clipboard.setContent 失败，回退 electron writeImage', error)
    }

    // 2) Electron 原生兜底（preload 内可用，不经 SDK）
    try {
      const image = nativeImage.createFromDataURL(dataUrl)
      if (image.isEmpty()) {
        return { ok: false, error: '图片解码为空' }
      }
      clipboard.writeImage(image)
      return { ok: true, method: 'electron.clipboard.writeImage' }
    } catch (error) {
      console.error('[qr-toolkit] copyImageDataUrl 失败', error)
      return {
        ok: false,
        error: error && error.message ? error.message : String(error),
      }
    }
  },

  joinPaths: (...args) => path.join(...args),
  getDirname: (filePath) => path.dirname(filePath),
  getBasename: (filePath, ext) => path.basename(filePath, ext),
})

console.info('[qr-toolkit][preload] window.qrToolkitPreload 就绪')
