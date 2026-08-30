import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import type {
  BrickServiceRecord,
  ListEntriesResult,
  ShareConfigInput,
  ShareStatus
} from './types'

let runtime: BricklyStartedHandle | null = null

export function bindRuntime(handle: BricklyStartedHandle | null): void {
  runtime = handle
}

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

function invokeApi(): { invoke<TResult = unknown>(commandId: string, input: Record<string, unknown>): Promise<TResult> } | undefined {
  return runtime ?? window.brickly
}

async function invoke<T>(commandId: string, input: Record<string, unknown>): Promise<T> {
  const api = invokeApi()
  if (!api?.invoke) {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return api.invoke<T>(commandId, input)
}

function requireService() {
  const service = requireBrickly().service
  if (!service || typeof service.getStatus !== 'function') {
    throw new Error('window.brickly.service 不可用，请确认本工具已声明 service 生命周期。')
  }
  return service
}

export async function getBrickServiceStatus(): Promise<BrickServiceRecord> {
  return (await requireService().getStatus()) as BrickServiceRecord
}

export async function startBrickService(): Promise<void> {
  await requireService().start()
}

export async function stopBrickService(): Promise<void> {
  await requireService().stop()
}

export function fetchStatus(): Promise<ShareStatus> {
  return invoke<ShareStatus>('status', {})
}

export function startShare(input: ShareConfigInput): Promise<ShareStatus> {
  return invoke<ShareStatus>('start', input as Record<string, unknown>)
}

export function stopShare(): Promise<ShareStatus> {
  return invoke<ShareStatus>('stop', {})
}

export async function updateConfig(input: ShareConfigInput): Promise<void> {
  await invoke('update-config', input as Record<string, unknown>)
}

export function fetchDefaultRoot(): Promise<string> {
  return invoke<string>('default-root', {})
}

export function listEntries(subPath: string): Promise<ListEntriesResult> {
  return invoke<ListEntriesResult>('list-entries', { subPath })
}

export async function clearLog(): Promise<void> {
  await invoke('clear-log', {})
}

export async function pickDirectory(options?: {
  defaultPath?: string
}): Promise<string | undefined> {
  return requireBrickly().fs.pickDirectory(options)
}

export async function openUrl(url: string): Promise<void> {
  await requireBrickly().system.shellOpenExternal(url)
}
