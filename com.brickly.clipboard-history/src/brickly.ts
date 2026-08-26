import type { BricklyStartedHandle, BricklyUiEventEnvelope } from '@syllm/brickly-ui'
import type {
  ClipItem,
  ClipboardContent,
  ClipboardHistoryChangedEnvelope,
  ClipboardHistoryChangedPayload,
  ClipboardSetResult,
  RuntimeStatus,
  StorageInfo,
  SyncResult
} from './types'

const LOG_PREFIX = '[clipboard-history/ui]'
const BRICK_ID = 'com.brickly.clipboard-history'

let runtime: BricklyStartedHandle | null = null

function logWarn(message: string, detail?: Record<string, unknown>): void {
  if (detail === undefined) {
    console.warn(`${LOG_PREFIX} ${message}`)
    return
  }
  console.warn(`${LOG_PREFIX} ${message}`, detail)
}

export function bindRuntime(handle: BricklyStartedHandle | null): void {
  runtime = handle
}

function invokeApi(): { invoke<TResult = unknown>(commandId: string, input: Record<string, unknown>): Promise<TResult> } | undefined {
  return runtime ?? window.brickly
}

async function invoke<T>(commandId: string, input: Record<string, unknown>): Promise<T> {
  const api = invokeApi()
  if (!api?.invoke) throw new Error('当前页面没有可用的 Clipboard History runtime。')
  try {
    return await api.invoke<T>(commandId, input)
  } catch (error) {
    logWarn('invoke failed', {
      commandId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export function startRuntimeService(): Promise<unknown> {
  const start = window.brickly?.service?.start
  if (!start) throw new Error('当前页面没有可用的 Clipboard History service 控制面。')
  return Promise.resolve(start()).catch((error: unknown) => {
    logWarn('service.start failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  })
}

export async function listHistory(limit = 500): Promise<ClipItem[]> {
  const result = await invoke<{ items?: ClipItem[] }>('list', { limit })
  return Array.isArray(result?.items) ? result.items : []
}

export function readHistoryText(id: string): Promise<string> {
  return invoke<string>('read-text', { id })
}

export async function removeHistoryItem(id: string): Promise<boolean> {
  const result = await invoke<{ ok?: boolean }>('remove', { id })
  return Boolean(result?.ok)
}

export async function clearHistory(keepFavorites = false): Promise<boolean> {
  const result = await invoke<{ ok?: boolean }>('clear', { keepFavorites })
  return Boolean(result?.ok)
}

export async function toggleHistoryFavorite(id: string, favorite?: boolean): Promise<boolean> {
  const result = await invoke<{ favorite?: boolean }>('toggle-favorite', { id, favorite })
  return Boolean(result?.favorite)
}

export function getStorageInfo(): Promise<StorageInfo> {
  return invoke<StorageInfo>('storage-info', {})
}

export function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>('runtime-status', {})
}

export function syncClipboardNow(): Promise<SyncResult> {
  return invoke<SyncResult>('sync-now', {})
}

export function setClipboardContent(content: ClipboardContent): Promise<ClipboardSetResult> {
  return invoke<ClipboardSetResult>('set-content', { content })
}

export async function getFileIcon(filePath: string): Promise<string> {
  const getIcon = window.brickly?.system?.getFileIcon
  if (!getIcon) throw new Error('当前页面没有可用的文件图标接口。')
  return getIcon(filePath)
}

export async function subscribeHistoryChanged(
  listener: (envelope: ClipboardHistoryChangedEnvelope) => void
): Promise<() => void | Promise<void>> {
  const events = window.brickly?.events
  if (!events?.subscribe) throw new Error('当前页面没有可用的剪贴板历史事件接口。')
  const dispose = await events.subscribe('clipboard-history:changed', (envelope) => {
    try {
      listener(readEventPayload(envelope))
    } catch (error: unknown) {
      logWarn('event payload read failed (swallowed)', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
  return dispose
}

/**
 * 事件 payload 就是业务对象。单测仍可能传入旧的 sourceBrickId 字段，正式信封用 source.ref.brickId。
 */
function readEventPayload(
  envelope: BricklyUiEventEnvelope & { sourceBrickId?: string }
): ClipboardHistoryChangedEnvelope {
  const payload = envelope.payload
  if (!isHistoryChangedPayload(payload)) {
    throw new Error('剪贴板历史事件 payload 结构无效。')
  }
  return {
    event: 'clipboard-history:changed',
    payload,
    sourceBrickId: sourceBrickIdOf(envelope),
    publishedAt: envelope.publishedAt
  }
}

function sourceBrickIdOf(envelope: BricklyUiEventEnvelope & { sourceBrickId?: string }): string {
  if (typeof envelope.sourceBrickId === 'string' && envelope.sourceBrickId) {
    return envelope.sourceBrickId
  }
  if (envelope.source?.kind === 'brick') return envelope.source.ref.brickId
  return BRICK_ID
}

function isHistoryChangedPayload(value: unknown): value is ClipboardHistoryChangedPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<ClipboardHistoryChangedPayload>
  return typeof payload.revision === 'number' && typeof payload.count === 'number' &&
    typeof payload.reason === 'string' && typeof payload.at === 'number'
}

/**
 * 合并历史刷新请求。
 *
 * 重要：不要用 setTimeout 做 debounce。
 * Brick 窗口在失焦/后台时，Chromium 会大幅节流 renderer 定时器，
 * 表现就是「事件到了但要等点回 UI 才 list」。这里改成：
 * - 立即排队一次 refresh（microtask，不受后台 timer throttle 影响）
 * - 运行中的新事件只打 pending 标记，结束后再刷一轮（合并突发）
 * - 仍按 revision/at 去重
 */
export function createHistoryRefreshScheduler(refresh: () => void | Promise<void>): {
  schedule(envelope: ClipboardHistoryChangedEnvelope): void
  cancel(): void
} {
  let active = true
  let running = false
  let pending = false
  let lastEventKey = ''
  let latestPublishedAt = 0

  const runLoop = (): void => {
    if (!active || running) return
    running = true

    void (async () => {
      try {
        do {
          pending = false
          if (!active) break
          await refresh()
        } while (active && pending)
      } catch (error) {
        logWarn('scheduler refresh failed', {
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        running = false
        if (active && pending) queueMicrotask(runLoop)
      }
    })()
  }

  return {
    schedule(envelope) {
      if (!active) return
      const eventKey = `${envelope.payload.revision}:${envelope.payload.at}`
      if (eventKey === lastEventKey || envelope.publishedAt < latestPublishedAt) return
      lastEventKey = eventKey
      latestPublishedAt = envelope.publishedAt

      if (running || pending) {
        pending = true
        return
      }

      pending = true
      queueMicrotask(runLoop)
    },
    cancel() {
      active = false
      pending = false
    }
  }
}
