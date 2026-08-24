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
  createdAt: number
  favorite?: boolean
  externalStatus?: 'changed' | 'missing' | 'offline' | 'permission-denied'
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

export type HistoryChangeReason = 'insert' | 'remove' | 'clear' | 'favorite' | 'sync'

export type ClipboardHistoryChangedPayload = {
  revision: number
  count: number
  reason: HistoryChangeReason
  at: number
}

export type ClipboardHistoryChangedEnvelope = {
  event: 'clipboard-history:changed'
  payload: ClipboardHistoryChangedPayload
  sourceBrickId: string
  publishedAt: number
}

export type RuntimeStatus = {
  state: 'running' | 'error'
  enabled: boolean
  startedAt: number
  uptimeMs: number
  count: number
  maxItems: number
  processedEvents: number
  lastEventAt?: number
  lastEventKind?: ClipType
  lastError?: string
  revision: number
}

export type StorageInfo = {
  brickId: string
  dataDir: string
  mediaDir: string
  dbPath: string
  count: number
  maxItems: number
}

export type SyncResult = {
  changed: boolean
  reason: 'sync'
  revision: number
  item?: ClipItem
}

