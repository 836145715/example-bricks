import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import { unwrapHealth } from './health'
import type { HealthStatus, PreviewResult, SearchCategory, SearchResult, SearchSort } from './types'

let runtime: BricklyStartedHandle | null = null

export function bindRuntime(handle: BricklyStartedHandle | null): void {
  runtime = handle
}

export function hasBrickly(): boolean {
  return Boolean(window.brickly)
}

export function hasRuntime(): boolean {
  return runtime != null
}

function requireRuntime(): BricklyStartedHandle {
  if (!runtime) {
    throw new Error('本地搜索 Runtime 尚未就绪')
  }
  return runtime
}

function requireBrickly() {
  if (!window.brickly) {
    throw new Error('本地搜索接口未注入')
  }
  return window.brickly
}

export async function searchFiles(input: {
  query: string
  category: SearchCategory
  offset: number
  limit: number
  sort: SearchSort
}): Promise<SearchResult> {
  return requireRuntime().invoke<SearchResult>('search', input)
}

export async function checkHealth(): Promise<HealthStatus> {
  return unwrapHealth(await requireRuntime().invoke('health', {}))
}

export async function previewFile(input: {
  path: string
  maxBytes?: number
  maxEntries?: number
}): Promise<PreviewResult> {
  return requireRuntime().invoke<PreviewResult>('preview', input)
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

export async function openExternal(url: string): Promise<void> {
  const api = requireBrickly()
  if (typeof api.system.shellOpenExternal !== 'function') {
    throw new Error('当前环境无法打开外部链接')
  }
  await api.system.shellOpenExternal(url)
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
