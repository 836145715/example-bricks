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
  sourceBrickId: 'com.brickly.clipboard-history'
  publishedAt: number
}

export type RuntimeStatus = {
  state: 'running' | 'error'
  enabled: boolean
  startedAt: number
  uptimeMs: number
  count: number
  maxItems: number
  dedupeHits: number
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
  dedupeHits: number
}

export type SyncResult = {
  changed: boolean
  reason: 'sync'
  revision: number
  count: number
}

export type BricklyWindowControls = {
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizeChange(callback: (maximized: boolean) => void): () => void
}

export type BricklyUiApi = {
  brickId?: string
  instanceId?: string
  closeWindow?: () => void
  window?: BricklyWindowControls
  invoke?: (commandId: string, input: Record<string, unknown>) => Promise<unknown>
  events?: {
    subscribe: (
      event: string,
      listener: (envelope: ClipboardHistoryChangedEnvelope) => void
    ) => Promise<() => void | Promise<void>>
  }
  service?: {
    start: () => Promise<unknown>
  }
  system?: {
    getFileIcon?: (filePath: string) => Promise<string>
  }
}

declare global {
  interface Window {
    brickly?: BricklyUiApi
  }
}
