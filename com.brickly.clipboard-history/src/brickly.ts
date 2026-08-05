import type {
  ClipItem,
  ClipboardContent,
  ClipboardHistoryChangedEnvelope,
  ClipboardSetResult,
  RuntimeStatus,
  StorageInfo,
  SyncResult
} from './types'

async function invoke<T>(commandId: string, input: Record<string, unknown>): Promise<T> {
  const api = window.brickly
  if (!api?.invoke) throw new Error('当前页面没有可用的 Clipboard History runtime。')
  return api.invoke(commandId, input) as Promise<T>
}

export async function listHistory(limit = 500): Promise<ClipItem[]> {
  const result = await invoke<{ items?: ClipItem[] }>('list', { limit })
  return Array.isArray(result?.items) ? result.items : []
}

export async function removeHistoryItem(id: string): Promise<boolean> {
  const result = await invoke<{ ok?: boolean }>('remove', { id })
  return Boolean(result?.ok)
}

export async function clearHistory(keepFavorites = false): Promise<boolean> {
  const result = await invoke<{ ok?: boolean }>('clear', { keepFavorites })
  return Boolean(result?.ok)
}

export async function toggleHistoryFavorite(id: string): Promise<boolean> {
  const result = await invoke<{ favorite?: boolean }>('toggle-favorite', { id })
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
  const events = window.clipboardHistoryEvents
  if (!events?.subscribe) throw new Error('当前页面没有可用的剪贴板历史事件接口。')
  return events.subscribe(listener)
}

export function createHistoryRefreshScheduler(
  refresh: () => void | Promise<void>,
  delayMs = 100
): {
  schedule(envelope: ClipboardHistoryChangedEnvelope): void
  cancel(): void
} {
  let active = true
  let timer: number | undefined
  let lastEventKey = ''
  let latestPublishedAt = 0

  return {
    schedule(envelope) {
      if (!active) return
      const eventKey = `${envelope.payload.revision}:${envelope.payload.at}`
      if (eventKey === lastEventKey || envelope.publishedAt < latestPublishedAt) return
      lastEventKey = eventKey
      latestPublishedAt = envelope.publishedAt
      if (timer !== undefined) return
      timer = window.setTimeout(async () => {
        timer = undefined
        if (active) await refresh()
      }, delayMs)
    },
    cancel() {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }
  }
}
