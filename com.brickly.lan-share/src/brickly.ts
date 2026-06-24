import type { ListEntriesResult, ShareConfigInput, ShareStatus } from './types'

/** 封装 window.brickly.invoke，集中处理可用性校验与类型断言。 */
function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

export async function fetchStatus(): Promise<ShareStatus> {
  return requireBrickly().invoke('status', {}) as Promise<ShareStatus>
}

export async function startShare(input: ShareConfigInput): Promise<ShareStatus> {
  return requireBrickly().invoke('start', input as Record<string, unknown>) as Promise<ShareStatus>
}

export async function stopShare(): Promise<ShareStatus> {
  return requireBrickly().invoke('stop', {}) as Promise<ShareStatus>
}

export async function updateConfig(input: ShareConfigInput): Promise<void> {
  await requireBrickly().invoke('update-config', input as Record<string, unknown>)
}

export async function fetchDefaultRoot(): Promise<string> {
  return requireBrickly().invoke('default-root', {}) as Promise<string>
}

export async function listEntries(subPath: string): Promise<ListEntriesResult> {
  return requireBrickly().invoke('list-entries', { subPath }) as Promise<ListEntriesResult>
}

export async function clearLog(): Promise<void> {
  await requireBrickly().invoke('clear-log', {})
}

export async function openFolder(path?: string): Promise<void> {
  await requireBrickly().invoke('open-folder', path ? { path } : {})
}

export async function openUrl(url: string): Promise<void> {
  await requireBrickly().invoke('open-url', { url })
}
