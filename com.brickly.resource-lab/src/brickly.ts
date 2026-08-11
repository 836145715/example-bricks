import type { RendererResourceHandle, RendererResourceRef, RunSnapshot, SuiteCatalog } from './types'
import { isRunSnapshot } from './run-state'

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
  resources?: { open(ref: RendererResourceRef): RendererResourceHandle }
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
    onResult: (result) => {
      try {
        onResult(requireRunSnapshot(result))
      } catch (error) {
        onError({ code: 'INVALID_RESPONSE', message: toErrorMessage(error) })
      }
    },
    onError
  })
}

export function getRunStatus(runId: string): Promise<RunSnapshot> {
  return invoke<unknown>('suite-status', { runId }).then(requireRunSnapshot)
}

export function listRunStatuses(): Promise<{ runs: RunSnapshot[] }> {
  return invoke<unknown>('suite-status', {}).then(requireRunHistory)
}

export function cancelRun(runId: string): Promise<RunSnapshot> {
  return invoke<unknown>('suite-cancel', { runId }).then(requireRunSnapshot)
}

export async function exportRun(runId: string): Promise<string> {
  const ref = requireResourceRef(await invoke<unknown>('suite-export', { runId }))
  const open = requireApi().resources?.open
  if (!open) throw new Error('当前窗口不支持打开报告资源。')
  const handle = open(ref)
  try {
    return await handle.text()
  } finally {
    await handle.close?.().catch(() => undefined)
    await handle.revoke?.().catch(() => undefined)
  }
}

function requireResourceRef(value: unknown): RendererResourceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime 未返回报告 ResourceRef。')
  }
  const ref = value as Partial<RendererResourceRef>
  if (
    ref.kind !== 'brickly.resource' ||
    typeof ref.resourceId !== 'string' || !ref.resourceId ||
    typeof ref.accessToken !== 'string' || !ref.accessToken ||
    typeof ref.sizeBytes !== 'number' ||
    typeof ref.sha256 !== 'string' ||
    typeof ref.expiresAt !== 'number'
  ) {
    throw new Error('Runtime 未返回报告 ResourceRef。')
  }
  return ref as RendererResourceRef
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
      return requireRunSnapshot(await handle.json<unknown>())
    } finally {
      await handle.close?.().catch(() => undefined)
    }
  }
  return requireRunSnapshot(payload)
}

function requireRunSnapshot(value: unknown): RunSnapshot {
  if (isRunSnapshot(value)) return value
  throw new Error('Resource Lab 运行快照结构无效。')
}

function requireRunHistory(value: unknown): { runs: RunSnapshot[] } {
  const runs = value && typeof value === 'object' ? (value as { runs?: unknown }).runs : undefined
  if (!Array.isArray(runs) || !runs.every(isRunSnapshot)) {
    throw new Error('Resource Lab 运行历史结构无效。')
  }
  return { runs }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Resource Lab 返回结构无效。'
}

function invoke<T>(commandId: string, input: Record<string, unknown>): Promise<T> {
  return requireApi().invoke(commandId, input) as Promise<T>
}

function requireApi(): BricklyApi {
  if (!window.brickly?.invoke) throw new Error('当前页面没有可用的 Resource Lab Runtime。')
  return window.brickly
}
