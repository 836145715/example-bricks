import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import type { RendererResourceHandle, RendererResourceRef, RunSnapshot, SuiteCatalog } from './types'
import { isRunSnapshot } from './run-state'

let runtime: BricklyStartedHandle | null = null

export function bindRuntime(handle: BricklyStartedHandle | null): void {
  runtime = handle
}

export function hasRuntime(): boolean {
  return runtime != null
}

function requireRuntime(): BricklyStartedHandle {
  if (!runtime) {
    throw new Error('Resource Lab Runtime 尚未就绪，请先 start()。')
  }
  return runtime
}

export function listSuite(): Promise<SuiteCatalog> {
  return requireRuntime().invoke<SuiteCatalog>('suite-list', {})
}

export function runSuite(
  input: { runId: string; mode?: 'default' | 'stress'; ids?: string[] },
  onResult: (snapshot: RunSnapshot) => void,
  onError: (error: { code?: string; message?: string }) => void = () => undefined
): { cancel(): void } {
  const abort = new AbortController()
  void requireRuntime()
    .invoke('suite-run', input)
    .then((result) => {
      try {
        onResult(requireRunSnapshot(result))
      } catch (error) {
        if (abort.signal.aborted) {
          onError({ code: 'CANCELLED', message: '测试已取消。' })
          return
        }
        onError({ code: 'INVALID_RESPONSE', message: toErrorMessage(error) })
      }
    })
    .catch((error) => {
      if (abort.signal.aborted || errorCode(error) === 'CANCELLED') {
        onError({ code: 'CANCELLED', message: '测试已取消。' })
        return
      }
      onError({
        code: errorCode(error),
        message: toErrorMessage(error)
      })
    })
  return {
    cancel() {
      abort.abort()
      void cancelRun(input.runId).catch(() => undefined)
    }
  }
}

export function getRunStatus(runId: string): Promise<RunSnapshot> {
  return requireRuntime().invoke('suite-status', { runId }).then(requireRunSnapshot)
}

export function listRunStatuses(): Promise<{ runs: RunSnapshot[] }> {
  return requireRuntime().invoke('suite-status', {}).then(requireRunHistory)
}

export function cancelRun(runId: string): Promise<RunSnapshot> {
  return requireRuntime().invoke('suite-cancel', { runId }).then(requireRunSnapshot)
}

export async function exportRun(runId: string): Promise<string> {
  const ref = requireResourceRef(await requireRuntime().invoke('suite-export', { runId }))
  const open = window.brickly?.resources?.open
  if (!open) throw new Error('当前窗口不支持打开报告资源。')
  const handle = open(ref)
  try {
    return await handle.text()
  } finally {
    await handle.close?.().catch(() => undefined)
    await handle.revoke?.().catch(() => undefined)
  }
}

export function prepareRestart(runId: string): Promise<{
  status: string
  runId: string
  preparedAt: number
  checkpoint: Record<string, unknown>
}> {
  return requireRuntime().invoke('restart-prepare', { runId })
}

export function verifyRestart(checkpoint?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return requireRuntime().invoke('restart-verify', checkpoint ? { checkpoint } : {})
}

export async function subscribeRunUpdates(
  listener: (snapshot: RunSnapshot) => void
): Promise<() => void | Promise<void>> {
  const events = window.brickly?.events
  if (!events?.subscribe) throw new Error('当前窗口不支持 Resource Lab 事件订阅。')
  return events.subscribe('resource-lab:run-updated', (envelope) => {
    void hydrateSnapshot(envelope.payload).then(listener).catch(() => undefined)
  })
}

function requireResourceRef(value: unknown): RendererResourceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime 未返回报告 ResourceRef。')
  }
  const ref = value as Partial<RendererResourceRef>
  if (
    ref.kind !== 'brickly.resource' ||
    typeof ref.resourceId !== 'string' ||
    !ref.resourceId ||
    typeof ref.sizeBytes !== 'number' ||
    typeof ref.sha256 !== 'string' ||
    typeof ref.expiresAt !== 'number'
  ) {
    throw new Error('Runtime 未返回报告 ResourceRef。')
  }
  return ref as RendererResourceRef
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

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Resource Lab 返回结构无效。'
}
