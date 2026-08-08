import type {
  BrickServiceRecord,
  ListEntriesResult,
  ShareConfigInput,
  ShareStatus
} from './types'

/** 封装 window.brickly.invoke，集中处理可用性校验与类型断言。 */
function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

function requireService() {
  const service = requireBrickly().service
  if (!service || typeof service.getStatus !== 'function') {
    throw new Error('window.brickly.service 不可用，请确认本工具已声明 service 生命周期。')
  }
  return service
}

export async function getBrickServiceStatus(): Promise<BrickServiceRecord> {
  return requireService().getStatus()
}

export async function startBrickService(): Promise<void> {
  await requireService().start()
}

export async function stopBrickService(): Promise<void> {
  await requireService().stop()
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

export async function pickDirectory(options?: {
  defaultPath?: string
}): Promise<string | undefined> {
  return requireBrickly().fs.pickDirectory(options)
}

export async function openUrl(url: string): Promise<void> {
  await requireBrickly().system.shellOpenExternal(url)
}
