export type PasteIntent =
  | { kind: 'files'; paths: string[] }
  | { kind: 'path'; path: string }
  | { kind: 'text'; text: string }

export function looksLikeAbsolutePath(text: string): boolean {
  const value = text.trim()
  if (!value || value.includes('\n') || value.includes('\r')) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\')) return true
  if (value.startsWith('/') && !value.startsWith('//')) return true
  return false
}

function isWindowsHost(): boolean {
  const proc = (globalThis as { process?: { platform?: string } }).process
  if (proc?.platform) return proc.platform === 'win32'
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent ?? '')
}

/** Local file the host can upload. Remote `/home/...` copied from SSH is not a Windows path. */
export function looksLikeLocalFilePath(text: string): boolean {
  const value = text.trim()
  if (!value || value.includes('\n') || value.includes('\r')) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\')) return true
  if (isWindowsHost()) return false
  return value.startsWith('/') && !value.startsWith('//')
}

export function pathForFile(file: File): string {
  const record = file as File & { path?: string }
  return typeof record.path === 'string' ? record.path : ''
}

export function pathsFromFileList(list: FileList | File[] | null | undefined): string[] {
  if (!list) return []
  const files = Array.from(list)
  const paths = files.map(pathForFile).filter(Boolean)
  return unique(paths)
}

export function classifyPaste(input: { files?: FileList | File[] | null; text?: string }): PasteIntent {
  const paths = pathsFromFileList(input.files)
  if (paths.length > 0) {
    return { kind: 'files', paths }
  }
  const text = input.text ?? ''
  if (looksLikeLocalFilePath(text)) {
    return { kind: 'path', path: text.trim() }
  }
  return { kind: 'text', text }
}

export function fileNamesFromList(list: FileList | File[] | null | undefined): string[] {
  if (!list) return []
  return unique(Array.from(list).map((file) => file.name).filter(Boolean))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
