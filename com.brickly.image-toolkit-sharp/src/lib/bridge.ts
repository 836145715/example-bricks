import type { ProcessImageInput, ProcessImageResult } from '../types'

export function streamProcessImage(
  input: ProcessImageInput,
  handlers: {
    onProgress?: (p: number, msg?: string) => void
    onResult?: (r: ProcessImageResult) => void
    onError?: (e: { message: string }) => void
  },
): void {
  const brickly = window.brickly
  if (!brickly?.call) {
    handlers.onError?.({ message: 'SDK 未注入，无法调用后台' })
    return
  }

  void brickly
    .call('process-image', input, {
      onEvent(event) {
        if (!event || typeof event !== 'object') return
        const rec = event as { type?: string; progress?: number; message?: string }
        if (rec.type === 'progress') {
          handlers.onProgress?.(Number(rec.progress ?? 0), rec.message)
        }
      },
    })
    .then((result) => {
      handlers.onResult?.(result as ProcessImageResult)
    })
    .catch((error: unknown) => {
      handlers.onError?.({
        message: error instanceof Error ? error.message : String(error),
      })
    })
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
