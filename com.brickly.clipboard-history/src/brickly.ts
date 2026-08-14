import type {
  ClipItem,
  ClipboardContent,
  ClipboardHistoryChangedEnvelope,
  ClipboardHistoryChangedPayload,
  ClipboardHistoryChangedResourceEnvelope,
  ClipboardHistoryEventResourceHandle,
  ClipboardSetResult,
  RuntimeStatus,
  StorageInfo,
  SyncResult
} from './types'

const LOG_PREFIX = '[clipboard-history/ui]'

function logWarn(message: string, detail?: Record<string, unknown>): void {
  if (detail === undefined) {
    console.warn(`${LOG_PREFIX} ${message}`)
    return
  }
  console.warn(`${LOG_PREFIX} ${message}`, detail)
}

async function invoke<T>(commandId: string, input: Record<string, unknown>): Promise<T> {
  const api = window.brickly
  if (!api?.invoke) throw new Error('当前页面没有可用的 Clipboard History runtime。')
  try {
    return (await api.invoke(commandId, input)) as T
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
    void readEventPayload(envelope)
      .then((read) => listener(read))
      .catch((error: unknown) => {
        logWarn('event payload read failed (swallowed)', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
  })
  return dispose
}

/**
 * 宿主对事件 payload 统一资源化（encoding:json wrapper），preload 已解包为
 * Handle，这里只读回内容并校验；payload 异常时 reject 由订阅方吞掉。
 */
async function readEventPayload(
  envelope: ClipboardHistoryChangedResourceEnvelope
): Promise<ClipboardHistoryChangedEnvelope> {
  const handle = envelope.payload as ClipboardHistoryEventResourceHandle
  try {
    const payload = await handle.json<unknown>()
    if (!isHistoryChangedPayload(payload)) throw new Error('剪贴板历史事件 payload 结构无效。')
    return { ...envelope, payload }
  } finally {
    await handle.close?.().catch(() => undefined)
  }
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
        // 收尾瞬间又来事件：再开一轮
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
      // microtask：跟在当前 IPC/hydrate 回调后立刻跑，不走后台被节流的 setTimeout
      queueMicrotask(runLoop)
    },
    cancel() {
      active = false
      pending = false
    }
  }
}
