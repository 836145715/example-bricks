import type { RendererResourceHandle, RunSnapshot, SuiteCatalog } from './types'

interface BricklyApi {
  invoke(commandId: string, input: Record<string, unknown>): Promise<unknown>
  stream?(commandId: string, input: Record<string, unknown>, callbacks: {
    onResult?(result: unknown): void
    onError?(error: { code?: string; message?: string }): void
    onDone?(): void
  }): { cancel(): void }
  service?: { start(): Promise<unknown> }
  events?: {
    subscribe(event: string, listener: (envelope: { payload: unknown }) => void): Promise<() => void | Promise<void>>
  }
}

declare global {
  interface Window { brickly?: BricklyApi }
}

export async function startResourceLab(): Promise<void> {
  const start = requireApi().service?.start
  if (start) await start()
}

export function listSuite(): Promise<SuiteCatalog> {
  return invoke<SuiteCatalog>('suite-list', {})
}

export function runSuite(
  input: { runId: string; mode?: 'default' | 'stress'; ids?: string[] },
  onResult: (snapshot: RunSnapshot) => void,
  onError: (error: { code?: string; message?: string }) => void = () => undefined
): { cancel(): void } {
  const stream = requireApi().stream
  if (!stream) throw new Error('当前窗口不支持可取消的 Resource Lab 流式调用。')
  return stream('suite-run', input, {
    onResult: (result) => onResult(result as RunSnapshot),
    onError
  })
}

export function getRunStatus(runId: string): Promise<RunSnapshot> {
  return invoke('suite-status', { runId })
}

export function listRunStatuses(): Promise<{ runs: RunSnapshot[] }> {
  return invoke('suite-status', {})
}

export function cancelRun(runId: string): Promise<RunSnapshot> {
  return invoke('suite-cancel', { runId })
}

export async function exportRun(runId: string): Promise<string> {
  const handle = await invoke<RendererResourceHandle>('suite-export', { runId })
  if (!handle || typeof handle.text !== 'function') throw new Error('Runtime 未返回报告 ResourceHandle。')
  try {
    return await handle.text()
  } finally {
    await handle.close?.().catch(() => undefined)
    await handle.revoke?.().catch(() => undefined)
  }
}

export function prepareRestart(runId: string): Promise<{ status: string; runId: string; preparedAt: number; checkpoint: Record<string, unknown> }> {
  return invoke('restart-prepare', { runId })
}

export function verifyRestart(checkpoint?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return invoke('restart-verify', checkpoint ? { checkpoint } : {})
}

export async function subscribeRunUpdates(listener: (snapshot: RunSnapshot) => void): Promise<() => void | Promise<void>> {
  const events = requireApi().events
  if (!events?.subscribe) throw new Error('当前窗口不支持 Resource Lab 事件订阅。')
  return events.subscribe('resource-lab:run-updated', (envelope) => {
    void hydrateSnapshot(envelope.payload).then(listener).catch(() => undefined)
  })
}

async function hydrateSnapshot(payload: unknown): Promise<RunSnapshot> {
  if (payload && typeof (payload as RendererResourceHandle).json === 'function') {
    const handle = payload as RendererResourceHandle
    try {
      return await handle.json<RunSnapshot>()
    } finally {
      await handle.close?.().catch(() => undefined)
    }
  }
  if (payload && typeof payload === 'object') return payload as RunSnapshot
  throw new Error('Resource Lab 事件 payload 无效。')
}

function invoke<T>(commandId: string, input: Record<string, unknown>): Promise<T> {
  return requireApi().invoke(commandId, input) as Promise<T>
}

function requireApi(): BricklyApi {
  if (!window.brickly?.invoke) throw new Error('当前页面没有可用的 Resource Lab Runtime。')
  return window.brickly
}
