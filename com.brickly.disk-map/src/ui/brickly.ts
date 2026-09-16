/**
 * Brickly API 桥接：所有命令都必须经过 start() 拿到的 owned Handle 调用。
 * 直接 window.brickly.invoke 会创建 Call 级临时进程，扫到一半就被 SIGTERM。
 * window.brickly 的类型来自 @syllm/brickly-ui。
 */

import type { BricklyStartedHandle } from '@syllm/brickly-ui'

import type { ExtStat, ExtStatsResult, PeekResult, RecipeItem, ScanEvent, ScanResult, TrashResult, VolumeInfo } from './types'

export function hasBrickly(): boolean {
  return Boolean(window.brickly && typeof window.brickly.start === 'function')
}

export async function startRuntime(): Promise<BricklyStartedHandle> {
  if (!window.brickly?.start) {
    throw new Error('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用')
  }
  return window.brickly.start()
}

export async function queryVolume(handle: BricklyStartedHandle, root?: string): Promise<VolumeInfo> {
  return handle.invoke('volume', root ? { root } : {}) as Promise<VolumeInfo>
}

export async function queryRecipes(handle: BricklyStartedHandle): Promise<RecipeItem[]> {
  const res = (await handle.invoke('recipes', {})) as { items?: RecipeItem[] }
  return res.items ?? []
}

export async function peekNode(handle: BricklyStartedHandle, path?: string): Promise<PeekResult> {
  return handle.invoke('peek', path ? { path } : {}) as Promise<PeekResult>
}

export async function queryExtStats(handle: BricklyStartedHandle): Promise<ExtStat[]> {
  const res = (await handle.invoke('extstats', {})) as ExtStatsResult
  return res.items ?? []
}

export async function trashPaths(handle: BricklyStartedHandle, paths: string[]): Promise<TrashResult> {
  return handle.invoke('trash', { paths }) as Promise<TrashResult>
}

export async function scanTree(
  handle: BricklyStartedHandle,
  root: string | undefined,
  signal: AbortSignal,
  onEvent: (event: ScanEvent) => void
): Promise<ScanResult> {
  return handle.call('scan', root ? { root } : {}, {
    signal,
    onEvent(event) {
      onEvent(event as ScanEvent)
    }
  }) as Promise<ScanResult>
}

/** 在访达中显示 */
export function revealInFinder(path: string): void {
  void window.brickly?.system.shellShowItemInFolder(path).catch(() => undefined)
}

/** 选择新的扫描根目录 */
export async function pickRootDirectory(defaultPath?: string): Promise<string | undefined> {
  return window.brickly?.fs.pickDirectory({ defaultPath })
}
