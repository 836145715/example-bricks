import type { DecodeResult, GenerateResult } from '../types'

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

export async function decodeQr(input: {
  filePath?: string
  imageBase64?: string
}): Promise<DecodeResult> {
  const raw = (await requireBrickly().invoke('decode', input)) as DecodeResult
  return raw
}

export async function generateQr(input: {
  text: string
  size?: number
  margin?: number
  errorCorrection?: string
  darkColor?: string
  lightColor?: string
  moduleStyle?: 'square' | 'rounded' | 'dots'
  output?: { mode?: string; dir?: string; fileName?: string }
}): Promise<GenerateResult> {
  const raw = (await requireBrickly().invoke('generate', input)) as GenerateResult
  return raw
}

export function getPathForFile(file: File): string {
  try {
    return window.qrToolkitPreload?.getPathForFile(file) || ''
  } catch {
    return ''
  }
}

export async function openFolder(filePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!window.qrToolkitPreload?.openFolder) {
    return { ok: false, error: 'Preload 未就绪' }
  }
  return window.qrToolkitPreload.openFolder(filePath)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

/** 生成小缩略图 dataUrl，控制 localStorage 体积 */
export async function makeThumb(dataUrl: string, maxSide = 96): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl.slice(0, 2000))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        resolve('')
      }
    }
    img.onerror = () => resolve('')
    img.src = dataUrl
  })
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** dataURL → 明确 MIME 的 PNG Blob（剪贴板写入要求 image/png） */
async function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  if (blob.type === 'image/png' || dataUrl.startsWith('data:image/png')) {
    return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' })
  }

  // 非 PNG 时经 canvas 转码，确保剪贴板可识别
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败'))
      el.src = objectUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 不可用')
    ctx.drawImage(img, 0, 0)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png')
    })
    return pngBlob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * 复制为剪贴板「图片」，绝不回退成 base64 文本。
 * 优先 Electron preload → 再试浏览器 ClipboardItem。
 */
export async function copyImageDataUrl(dataUrl: string): Promise<boolean> {
  if (!dataUrl) return false

  // 1) 宿主原生（Electron writeImage / platform.clipboard）
  if (window.qrToolkitPreload?.copyImageDataUrl) {
    try {
      const r = await window.qrToolkitPreload.copyImageDataUrl(dataUrl)
      if (r?.ok) return true
    } catch {
      /* fall through */
    }
  }

  // 2) 浏览器 Clipboard API（image/png）
  try {
    const pngBlob = await dataUrlToPngBlob(dataUrl)
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      return false
    }
    // 部分 Chromium 要求 value 为 Promise<Blob>
    const item = new ClipboardItem({
      'image/png': pngBlob,
    })
    await navigator.clipboard.write([item])
    return true
  } catch {
    try {
      const pngBlob = await dataUrlToPngBlob(dataUrl)
      const item = new ClipboardItem({
        'image/png': Promise.resolve(pngBlob),
      })
      await navigator.clipboard.write([item])
      return true
    } catch {
      return false
    }
  }
}
