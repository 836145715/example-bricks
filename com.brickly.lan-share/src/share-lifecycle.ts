import { createStoppedStatus, toRuntimeConfig, type ShareSettings } from './share-settings'
import type {
  BrickServiceRecord,
  BrickServiceStatus,
  ShareConfigInput,
  ShareStatus
} from './types'

export interface ShareLifecycleApi {
  getServiceStatus(): Promise<BrickServiceRecord>
  startService(): Promise<void>
  stopService(): Promise<void>
  fetchStatus(): Promise<ShareStatus>
  startShare(config: ShareConfigInput): Promise<ShareStatus>
  stopShare(): Promise<ShareStatus>
}

export interface ShareSnapshot {
  service: BrickServiceRecord
  status: ShareStatus
}

export interface StopShareResult {
  snapshot: ShareSnapshot
  warning?: string
}

export function isServiceActive(status: BrickServiceStatus): boolean {
  return status === 'running' || isServiceTransitioning(status)
}

export function isServiceTransitioning(status: BrickServiceStatus): boolean {
  return status === 'starting' || status === 'restarting' || status === 'stopping'
}

export async function loadShareSnapshot(
  api: ShareLifecycleApi,
  settings: ShareSettings
): Promise<ShareSnapshot> {
  const service = await api.getServiceStatus()
  if (service.status !== 'running') {
    return stoppedSnapshot(service, settings)
  }

  try {
    return { service, status: await api.fetchStatus() }
  } catch (runtimeError) {
    const confirmed = await api.getServiceStatus()
    if (confirmed.status !== 'running') {
      return stoppedSnapshot(confirmed, settings)
    }
    throw runtimeError
  }
}

export async function startShareLifecycle(
  api: ShareLifecycleApi,
  input: ShareConfigInput,
  settings: ShareSettings
): Promise<ShareSnapshot> {
  let service = await api.getServiceStatus()
  let startedService = false

  if (service.status !== 'running') {
    await api.startService()
    startedService = true
    service = await api.getServiceStatus()
    if (service.status !== 'running') {
      const error = new Error(`宿主服务启动后状态为 ${service.status}，无法启动共享。`)
      await compensateServiceStart(api, error)
    }
  } else {
    const current = await api.fetchStatus()
    if (current.running) return { service, status: current }
  }

  try {
    const status = await api.startShare(toRuntimeConfig(input, settings.hasAccessCode))
    return { service, status }
  } catch (error) {
    if (startedService) {
      await compensateServiceStart(api, error)
    }
    throw error
  }
}

export async function stopShareLifecycle(
  api: ShareLifecycleApi,
  settings: ShareSettings
): Promise<StopShareResult> {
  const before = await api.getServiceStatus()
  if (before.status === 'stopped') {
    return { snapshot: stoppedSnapshot(before, settings) }
  }

  let runtimeStopError: unknown
  if (before.status === 'running') {
    try {
      await api.stopShare()
    } catch (error) {
      runtimeStopError = error
    }
  }

  let serviceStopError: unknown
  try {
    await api.stopService()
  } catch (error) {
    serviceStopError = error
  }

  let after: BrickServiceRecord
  try {
    after = await api.getServiceStatus()
  } catch (statusError) {
    throw combineErrors(
      serviceStopError ?? statusError,
      serviceStopError ? statusError : runtimeStopError,
      '停止后无法确认宿主服务状态'
    )
  }

  if (after.status !== 'stopped') {
    throw combineErrors(
      serviceStopError ?? new Error(`宿主服务停止后状态仍为 ${after.status}。`),
      runtimeStopError,
      '共享停止失败'
    )
  }

  const warning = joinMessages(runtimeStopError, serviceStopError)
  return {
    snapshot: stoppedSnapshot(after, settings),
    ...(warning ? { warning } : {})
  }
}

async function compensateServiceStart(api: ShareLifecycleApi, originalError: unknown): Promise<never> {
  try {
    await api.stopService()
  } catch (cleanupError) {
    throw combineErrors(originalError, cleanupError, 'runtime 启动失败且宿主服务补偿停止失败')
  }
  throw originalError
}

function stoppedSnapshot(service: BrickServiceRecord, settings: ShareSettings): ShareSnapshot {
  return { service, status: createStoppedStatus(settings) }
}

function combineErrors(primary: unknown, secondary: unknown, context: string): Error {
  const messages = [messageOf(primary), messageOf(secondary)].filter(Boolean)
  return new Error(`${context}：${messages.join('；')}`, { cause: primary })
}

function joinMessages(...errors: unknown[]): string {
  return errors.map(messageOf).filter(Boolean).join('；')
}

function messageOf(error: unknown): string {
  if (error === undefined || error === null) return ''
  if (error instanceof Error) return error.message
  return String(error)
}
