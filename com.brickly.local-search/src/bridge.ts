import type { HealthStatus, PreviewResult, SearchCategory, SearchResult, SearchSort } from './types'

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('本地搜索接口未注入')
  }
  return window.brickly
}

export function hasBrickly(): boolean {
  return Boolean(window.brickly && typeof window.brickly.invoke === 'function')
}

export async function searchFiles(input: {
  query: string
  category: SearchCategory
  offset: number
  limit: number
  sort: SearchSort
}): Promise<SearchResult> {
  return requireBrickly().invoke('search', input) as Promise<SearchResult>
}

export async function checkHealth(): Promise<HealthStatus> {
  return requireBrickly().invoke('health', {}) as Promise<HealthStatus>
}

export async function previewFile(input: {
  path: string
  maxBytes?: number
  maxEntries?: number
}): Promise<PreviewResult> {
  return requireBrickly().invoke('preview', input) as Promise<PreviewResult>
}

export async function getFileIcon(path: string): Promise<string> {
  try {
    return (await requireBrickly().system.getFileIcon(path)) || ''
  } catch {
    return ''
  }
}

export async function openPath(path: string): Promise<void> {
  await requireBrickly().system.shellOpenPath(path)
}

export async function showInFolder(path: string): Promise<void> {
  await requireBrickly().system.shellShowItemInFolder(path)
}

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('当前环境无法写入剪贴板')
  }
  await navigator.clipboard.writeText(text)
}
