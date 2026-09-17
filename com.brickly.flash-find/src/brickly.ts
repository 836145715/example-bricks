/**
 * Brickly API 桥接：所有命令都经过 start() 拿到的 owned Handle 调用。
 * 类型来自 @syllm/brickly-ui。
 */

import type { BricklyStartedHandle } from '@syllm/brickly-ui'

import type { SearchResponse, StatusInfo } from './types'

export function hasBrickly(): boolean {
  return Boolean(window.brickly && typeof window.brickly.start === 'function')
}

export async function startRuntime(): Promise<BricklyStartedHandle> {
  if (!window.brickly?.start) {
    throw new Error('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用')
  }
  return window.brickly.start()
}

export async function doSearch(
  handle: BricklyStartedHandle,
  query: string,
  scope: string,
  limit = 200
): Promise<SearchResponse> {
  const input: Record<string, unknown> = { query, limit }
  if (scope) input.scope = scope
  return handle.invoke('search', input) as Promise<SearchResponse>
}

export async function queryStatus(handle: BricklyStartedHandle): Promise<StatusInfo> {
  return handle.invoke('status', {}) as Promise<StatusInfo>
}

export async function reindex(handle: BricklyStartedHandle): Promise<void> {
  await handle.invoke('reindex', {})
}

/** 在访达中显示 */
export function revealInFinder(path: string): void {
  void window.brickly?.system.shellShowItemInFolder(path).catch(() => undefined)
}

/** 选择限定目录 */
export async function pickScopeDirectory(): Promise<string | undefined> {
  return window.brickly?.fs.pickDirectory({})
}
