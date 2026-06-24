/** 内网文件共享 UI 与 runtime 之间的数据契约。 */

export interface TransferLogEntry {
  id: string
  at: number
  ip: string
  method: string
  path: string
  status: number
  bytes: number
}

export interface AccessUrl {
  url: string
  host: string
  label: string
  private: boolean
}

export interface ShareStatus {
  running: boolean
  port: number
  root: string
  allowUpload: boolean
  hasAccessCode: boolean
  startedAt: number
  urls: AccessUrl[]
  log: TransferLogEntry[]
}

export interface ShareConfigInput {
  root?: string
  port?: number
  allowUpload?: boolean
  accessCode?: string
}

export interface DirEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

export interface ListEntriesResult {
  root: string
  subPath: string
  entries: DirEntry[]
  error?: string
}

export interface BricklyApi {
  brickId: string
  instanceId?: string
  invoke(commandId: string, input: Record<string, unknown>): Promise<unknown>
}

declare global {
  interface Window {
    brickly?: BricklyApi
  }
}
