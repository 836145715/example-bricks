import type {
  BricklyStreamHandlers,
  ProcessImageInput,
  ProcessImageResult,
} from '../types'

export function streamProcessImage(
  input: ProcessImageInput,
  handlers: {
    onProgress?: (p: number, msg?: string) => void
    onResult?: (r: ProcessImageResult) => void
    onError?: (e: { message: string }) => void
  },
): void {
  const brickly = window.brickly
  if (!brickly?.stream) {
    handlers.onError?.({ message: 'SDK 未注入，无法调用后台' })
    return
  }

  const streamHandlers: BricklyStreamHandlers = {
    onProgress: handlers.onProgress,
    onResult: handlers.onResult,
    onError: handlers.onError,
  }

  brickly.stream('process-image', input, streamHandlers)
}

export function getPathForFile(file: File): string {
  try {
    return window.imageToolkitPreload?.getPathForFile(file) || ''
  } catch {
    return ''
  }
}

export async function openFolder(filePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!window.imageToolkitPreload?.openFolder) {
    return { ok: false, error: 'Preload 未就绪' }
  }
  return window.imageToolkitPreload.openFolder(filePath)
}

export async function pickDirectory(): Promise<string | undefined> {
  if (window.brickly?.fs?.pickDirectory) {
    return window.brickly.fs.pickDirectory()
  }
  return undefined
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
