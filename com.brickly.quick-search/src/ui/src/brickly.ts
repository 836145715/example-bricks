/**
 * `window.brickly`（brick-child preload 注入）的类型化封装。
 * 页面 ↔ runtime 通道：
 *  - brickly.notify(name, payload)：fire-and-forget，runtime expose 的同名 handler 被调；
 *  - brickly.request(name, payload)：等 runtime handler 的 return 作为结果；
 *  - brickly.on(name, cb)：收 runtime `win.send(name, payload)` 的推送。
 */
import type { ActivationResult, SearchSnapshot } from './types'

interface BricklyChild {
  notify(name: string, payload?: unknown): void
  request<T = unknown>(name: string, payload?: unknown): Promise<T>
  on(name: string, listener: (payload?: unknown) => void): () => void
  off(name: string, listener: (payload?: unknown) => void): void
  readonly window: { close(): Promise<unknown> }
}

function api(): BricklyChild | undefined {
  return (globalThis as { brickly?: BricklyChild }).brickly
}

export function search(query: string): void {
  api()?.notify('search.query', { query })
}

export async function activate(resultId: string): Promise<ActivationResult | undefined> {
  return api()?.request<ActivationResult>('search.activate', { resultId })
}

export async function runAction(
  resultId: string,
  actionId: string
): Promise<ActivationResult | undefined> {
  return api()?.request<ActivationResult>('search.runAction', { resultId, actionId })
}

export function hideWindow(): void {
  api()?.notify('window.hide')
}

export function startDrag(): void {
  api()?.notify('drag.start')
}

export function endDrag(): void {
  api()?.notify('drag.end')
}

/** runtime 转发的渐进快照（已是当前查询轮次，无需再比 sequence）。 */
export function onSnapshot(listener: (snapshot: SearchSnapshot) => void): () => void {
  const channel = api()
  if (!channel) return () => undefined
  return channel.on('snapshot', (payload) => listener(payload as SearchSnapshot))
}

/** runtime 每次显示浮窗时推送（页面复位 + 聚焦输入框）。 */
export function onShown(listener: () => void): () => void {
  const channel = api()
  if (!channel) return () => undefined
  return channel.on('shown', () => listener())
}

export const channelReady = (): boolean => Boolean(api())
