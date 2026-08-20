import type {
  ExecResult,
  Host,
  HostDraft,
  SftpListResult,
  SftpProgress,
  SftpTransferResult,
  StreamHandle,
  TestResult
} from './types'

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('SSH 管理接口未注入')
  }
  return window.brickly
}

export function hasBrickly(): boolean {
  return Boolean(window.brickly && typeof window.brickly.invoke === 'function')
}

export function brickId(): string {
  return window.brickly?.ref?.brickId ?? window.brickly?.brickId ?? 'com.brickly.ssh-manager'
}

export async function listHosts(query = ''): Promise<Host[]> {
  const result = (await requireBrickly().invoke('list-hosts', { query })) as { hosts?: Host[] }
  return Array.isArray(result?.hosts) ? result.hosts : []
}

export async function saveHost(host: HostDraft): Promise<Host> {
  const result = (await requireBrickly().invoke('save-host', { host })) as { host: Host }
  return result.host
}

export async function deleteHost(hostId: string): Promise<void> {
  await requireBrickly().invoke('delete-host', { hostId })
}

export async function testConnection(input: { hostId?: string; host?: HostDraft }): Promise<TestResult> {
  return (await requireBrickly().invoke('test-connection', input)) as TestResult
}

export async function execCommand(input: {
  hostId?: string
  host?: HostDraft
  command: string
  timeoutMs?: number
}): Promise<ExecResult> {
  return (await requireBrickly().invoke('exec', input)) as ExecResult
}

export function openSession(
  input: { hostId: string; sessionId: string; cols: number; rows: number },
  callbacks: Parameters<NonNullable<Window['brickly']>['stream']>[2]
): StreamHandle {
  return requireBrickly().stream('open-session', input, callbacks)
}

export async function writeSession(sessionId: string, data: string): Promise<void> {
  await requireBrickly().invoke('write-session', { sessionId, data })
}

export async function resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
  await requireBrickly().invoke('resize-session', { sessionId, cols, rows })
}

export async function closeSession(sessionId: string): Promise<void> {
  await requireBrickly().invoke('close-session', { sessionId }).catch(() => undefined)
}

export async function sessionCwd(sessionId: string): Promise<string | null> {
  try {
    const result = (await requireBrickly().invoke('session-cwd', { sessionId })) as { path?: string }
    if (typeof result?.path === 'string' && result.path.startsWith('/')) return result.path
  } catch {
    return null
  }
  return null
}

export async function sftpList(input: {
  hostId: string
  sessionId?: string
  path?: string
}): Promise<SftpListResult> {
  return (await requireBrickly().invoke('sftp-list', input)) as SftpListResult
}

export function streamSftpUpload(
  input: {
    hostId: string
    sessionId?: string
    localPath: string
    remoteDir?: string
    overwrite?: boolean
  },
  callbacks: Parameters<NonNullable<Window['brickly']>['stream']>[2]
): StreamHandle {
  return requireBrickly().stream('sftp-upload', input, callbacks)
}

export function streamSftpDownload(
  input: {
    hostId: string
    sessionId?: string
    remotePath: string
    localDir: string
    overwrite?: boolean
  },
  callbacks: Parameters<NonNullable<Window['brickly']>['stream']>[2]
): StreamHandle {
  return requireBrickly().stream('sftp-download', input, callbacks)
}

export async function pickDirectory(defaultPath?: string): Promise<string | undefined> {
  return window.brickly?.fs?.pickDirectory(defaultPath ? { defaultPath } : undefined)
}

export function asSftpProgress(chunk: unknown): SftpProgress | null {
  if (!chunk || typeof chunk !== 'object') return null
  const record = chunk as SftpProgress
  if (typeof record.phase !== 'string') return null
  return record
}

export function asSftpResult(value: unknown): SftpTransferResult | null {
  if (!value || typeof value !== 'object') return null
  const record = value as SftpTransferResult
  if (typeof record.remotePath !== 'string') return null
  return record
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replaceAll('-', '')
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(raw: string): Uint8Array {
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export type StreamWriter = (bytes: Uint8Array | string) => void

export function decodeChunkBytes(chunk: unknown): Uint8Array | string | null {
  if (!chunk || typeof chunk !== 'object') return null
  const record = chunk as { encoding?: string; bytes?: string }
  if (record.encoding === 'base64' && typeof record.bytes === 'string') {
    return fromBase64(record.bytes)
  }
  return null
}

export function newTabId(prefix = 'tab'): string {
  return `${prefix}-${newSessionId()}`
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { message?: string; code?: string }
    if (record.message) return record.message
  }
  return error instanceof Error ? error.message : String(error)
}
