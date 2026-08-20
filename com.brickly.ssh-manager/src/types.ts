export type AuthType = 'password' | 'key'

export type Host = {
  id: string
  name: string
  group: string
  tags: string[]
  host: string
  port: number
  user: string
  authType: AuthType
  password?: string
  keyPath?: string
  keyText?: string
  passphrase?: string
  note?: string
}

export type HostDraft = Omit<Host, 'id'> & { id?: string }

export type SessionStatus = 'connecting' | 'open' | 'closed' | 'error'

export type SidebarTab = 'config' | 'files' | 'exec'

export type StartTab = {
  kind: 'start'
  id: string
}

export type SessionTab = {
  kind: 'session'
  id: string
  sessionId: string
  hostId: string
  title: string
  status: SessionStatus
  message?: string
  cols: number
  rows: number
  sftpDir?: string
  downloadDir?: string
  cwd?: string
}

export type Tab = StartTab | SessionTab

export type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type TestResult = {
  ok: boolean
  message: string
  latencyMs: number
}

export type StreamHandle = {
  cancel(): void
}

export type SftpEntry = {
  name: string
  path: string
  kind: 'file' | 'dir'
  size: number
  mtimeMs: number
  mode: string
  link?: boolean
}

export type SftpListResult = {
  path: string
  entries: SftpEntry[]
}

export type SftpProgress = {
  phase: 'connecting' | 'scanning' | 'upload' | 'download' | 'error' | string
  bytes: number
  totalBytes?: number
  percent?: number
  currentPath?: string
  remotePath?: string
  fileIndex?: number
  fileCount?: number
  fileBytes?: number
  fileTotalBytes?: number
}

export type SftpTransferResult = {
  ok: boolean
  remotePath: string
  localPath?: string
  bytes: number
}

export type TransferState = {
  status: 'running' | 'ok' | 'error'
  phase: string
  bytes: number
  totalBytes?: number
  percent?: number
  currentPath?: string
  remotePath?: string
  remoteDir: string
  fileIndex?: number
  fileCount?: number
  message: string
}

export type ConfirmState =
  | { kind: 'path'; path: string; remoteDir: string }
  | { kind: 'overwrite'; localPath?: string; remotePath?: string; remoteDir: string; mode: 'upload' | 'download' }

export type BricklyApi = {
  brickId?: string
  ref?: { brickId: string }
  invoke(commandId: string, input: Record<string, unknown>): Promise<unknown>
  stream(
    commandId: string,
    input: Record<string, unknown>,
    callbacks: {
      onProgress?: (progress: number, message?: string) => void
      onChunk?: (name: string | undefined, chunk: unknown) => void
      onOutput?: (name: string, value: unknown) => void
      onResult?: (result: unknown) => void
      onError?: (error: { code: string; message: string; details?: unknown }) => void
      onDone?: () => void
    }
  ): StreamHandle
  closeWindow?(): void
  fs?: {
    pickDirectory(options?: { defaultPath?: string }): Promise<string | undefined>
  }
  window?: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(callback: (maximized: boolean) => void): () => void
  }
}

declare global {
  interface Window {
    brickly?: BricklyApi
  }
}

export function emptyHostDraft(): HostDraft {
  return {
    name: '',
    group: '',
    tags: [],
    host: '',
    port: 22,
    user: '',
    authType: 'password',
    password: '',
    keyPath: '',
    keyText: '',
    passphrase: '',
    note: ''
  }
}

export function hostToDraft(host: Host): HostDraft {
  return {
    ...emptyHostDraft(),
    ...host,
    tags: host.tags ?? [],
    port: host.port || 22
  }
}
