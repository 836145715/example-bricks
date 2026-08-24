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
  hasPassword?: boolean
  hasKey?: boolean
  note?: string
}

export type HostDraft = Omit<Host, 'id' | 'hasPassword' | 'hasKey'> & {
  id?: string
  password?: string
  keyPath?: string
  keyText?: string
  passphrase?: string
}

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

export type SessionOpenedEvent = {
  type: 'session'
  session: { sessionId: string; hostId: string; status: 'open' }
}

export type SessionCwdEvent = {
  type: 'cwd'
  sessionId: string
  path: string
  pid?: number
}

export type SessionDataEvent = {
  type: 'data'
  sessionId: string
  encoding: 'base64'
  bytes: string
}

export type SessionStatusEvent = {
  type: 'status'
  sessionId: string
  status: 'closed' | 'error'
  exitCode?: number
}

export type SessionEvent = SessionOpenedEvent | SessionDataEvent | SessionStatusEvent | SessionCwdEvent

export type SftpProgressEvent = SftpProgress & {
  type: 'progress'
  progress?: number
  message?: string
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
    id: host.id,
    name: host.name,
    group: host.group,
    tags: host.tags ?? [],
    host: host.host,
    port: host.port || 22,
    user: host.user,
    authType: host.authType,
    note: host.note
  }
}
