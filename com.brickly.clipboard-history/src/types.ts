export type ClipType = 'text' | 'image' | 'file'

export type ClipItem = {
  id: string
  index?: number
  type: ClipType
  mimeType?: string
  text?: string
  title?: string
  preview?: string
  path?: string
  paths?: string[]
  imagePath?: string
  imageOriginalPath?: string
  width?: number
  height?: number
  size?: number
  sourceBrickId?: string
  event?: string
  resourceId?: string
  createdAt: number
  favorite?: boolean
}

export type WatcherStatus = {
  event?: string
  sourceBrickId?: string
  state?: string
  enabled?: boolean
  helperAvailable?: boolean
  uptimeMs?: number
  seen?: number
  published?: number
  lastEventAt?: number
  watchMode?: string
  supports?: string[]
  platform?: string
  lastEventKind?: string
  lastError?: string
}

export type EventEnvelope = {
  event: string
  payload?: Record<string, unknown>
  sourceBrickId?: string
  publishedAt?: number
}

export type ResourcePayload = {
  filePath?: string
  mimeType?: string
  name?: string
  size?: number
  content?: {
    text?: string
  }
}

export type ClipboardContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; path: string }
  | { kind: 'file'; paths: string[] }

export type ClipboardSetResult = {
  kind: 'text' | 'image' | 'file' | 'html' | 'rtf' | 'empty'
  formats: string[]
  updatedAt: number
  paths?: string[]
  names?: string[]
  width?: number
  height?: number
}

export type ClipboardHistoryStore = {
  list: () => Promise<ClipItem[]>
  remove: (id: string) => Promise<boolean>
  clear: (keepFavorites?: boolean) => Promise<boolean>
  toggleFavorite: (id: string) => Promise<boolean>
  /**
   * 同步快照：返回 preload 缓存的最近一次 storage-info；首次调用可能是 null。
   * 同时会在后台异步刷新缓存供下次使用。
   */
  storageInfo: () => unknown
  /**
   * 异步获取最新 storage-info。InfoDialog 打开时优先用这个保证拿到最新值。
   */
  refreshStorageInfo: () => Promise<unknown>
  subscribe: (callback: (event: string, items: ClipItem[]) => void) => () => void
}

export type PlatformApi = {
  onEvent?: (callback: (envelope: EventEnvelope) => void) => void
  subscribeEvent?: (event: string) => Promise<unknown>
  startService?: (brickId: string) => Promise<unknown>
  resourceGet?: (resourceId: string) => Promise<ResourcePayload | null>
  clipboard: {
    status: () => Promise<WatcherStatus>
    settings?: () => Promise<unknown>
    updateSettings: (patch: { enabled?: boolean }) => Promise<unknown>
    captureNow: () => Promise<WatcherStatus>
    setContent: (content: ClipboardContent) => Promise<ClipboardSetResult>
    listSubscribers?: () => Promise<unknown>
    setSubscriberEnabled?: (brickId: string, enabled: boolean) => Promise<unknown>
  }
  app?: {
    getFileIcon: (path: string) => Promise<string>
  }
}

export type ClipboardHistoryPlatform = {
  clipboard: {
    status: PlatformApi['clipboard']['status']
    captureNow: PlatformApi['clipboard']['captureNow']
    setContent: PlatformApi['clipboard']['setContent']
  }
  app?: PlatformApi['app']
}

declare global {
  interface Window {
    clipboardHistoryStore?: ClipboardHistoryStore
    clipboardHistoryPlatform?: ClipboardHistoryPlatform
    AIBricks?: {
      invoke?: <T = unknown>(brickId: string, commandId: string, input: Record<string, unknown>) => Promise<T>
      platform?: PlatformApi
    }
  }
}
