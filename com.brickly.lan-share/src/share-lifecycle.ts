import { createStoppedStatus, toRuntimeConfig, type ShareSettings } from './share-settings'
import type { ShareConfigInput, ShareStatus } from './types'

export interface ShareLifecycleApi {
  fetchStatus(): Promise<ShareStatus>
  startShare(config: ShareConfigInput): Promise<ShareStatus>
  stopShare(): Promise<ShareStatus>
}

export interface ShareSnapshot {
  status: ShareStatus
}

export interface StopShareResult {
  snapshot: ShareSnapshot
  warning?: string
}

export class ShareLifecycleStateError extends Error {
  constructor(
    message: string,
    readonly snapshot: ShareSnapshot,
    readonly runtimeStatusKnown: boolean,
    cause?: unknown
  ) {
    super(message, { cause })
    this.name = 'ShareLifecycleStateError'
  }
}

export class LifecycleRequestGate {
  private epoch = 0

  capture(): number {
    return this.epoch
  }

  invalidate(): void {
    this.epoch += 1
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.epoch
  }
}

export function canStartShare(sharing: boolean): boolean {
  return !sharing
}

export async function loadShareSnapshot(
  api: ShareLifecycleApi,
  settings: ShareSettings
): Promise<ShareSnapshot> {
  try {
    return { status: await api.fetchStatus() }
  } catch (runtimeError) {
    throw new ShareLifecycleStateError(
      messageOf(runtimeError),
      { status: createStoppedStatus(settings) },
      false,
      runtimeError
    )
  }
}

export async function startShareLifecycle(
  api: ShareLifecycleApi,
  input: ShareConfigInput,
  settings: ShareSettings
): Promise<ShareSnapshot> {
  const current = await api.fetchStatus()
  if (current.running) return { status: current }
  return { status: await api.startShare(toRuntimeConfig(input, settings.hasAccessCode)) }
}

export async function stopShareLifecycle(
  api: ShareLifecycleApi,
  settings: ShareSettings
): Promise<StopShareResult> {
  try {
    const current = await api.fetchStatus()
    if (!current.running) {
      return { snapshot: { status: current } }
    }
  } catch {
    // 状态读失败时仍尝试停止 HTTP 服务。
  }

  try {
    return { snapshot: { status: await api.stopShare() } }
  } catch (error) {
    throw new ShareLifecycleStateError(
      messageOf(error),
      { status: createStoppedStatus(settings) },
      false,
      error
    )
  }
}

function messageOf(error: unknown): string {
  if (error === undefined || error === null) return ''
  if (error instanceof Error) return error.message
  return String(error)
}
