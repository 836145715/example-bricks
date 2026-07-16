export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatSizeKb(sizeKb?: number, sizeBytes?: number): string {
  if (typeof sizeKb === 'number' && Number.isFinite(sizeKb)) {
    if (sizeKb >= 1024) return `${(sizeKb / 1024).toFixed(2)} MB`
    return `${sizeKb} KB`
  }
  if (typeof sizeBytes === 'number') return formatBytes(sizeBytes)
  return '-'
}

export function basename(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export function dirname(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return path
  return path.slice(0, idx)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function percentFromRange(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return ((value - min) / (max - min)) * 100
}
