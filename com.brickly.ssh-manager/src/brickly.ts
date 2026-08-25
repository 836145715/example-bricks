import type { BricklyInteraction, BricklyStartedHandle } from '@syllm/brickly-ui'
import type {
  ExecResult,
  Host,
  HostDraft,
  SessionEvent,
  SftpListResult,
  SftpProgress,
  SftpProgressEvent,
  SftpTransferResult
} from './types'

let runtime: BricklyStartedHandle | null = null

export function bindRuntime(handle: BricklyStartedHandle | null): void {
  runtime = handle
}

export function hasRuntime(): boolean {
  return runtime != null
}

function requireRuntime(): BricklyStartedHandle {
  if (!runtime) {
    throw new Error('SSH Runtime 尚未就绪')
  }
  return runtime
}

export async function listHosts(query = ''): Promise<Host[]> {
  const result = await requireRuntime().invoke<{ hosts?: Host[] }>('list-hosts', { query })
  return Array.isArray(result?.hosts) ? result.hosts : []
}

export async function saveHost(host: HostDraft): Promise<Host> {
  const result = await requireRuntime().invoke<{ host: Host }>('save-host', { host })
  return result.host
}

export async function deleteHost(hostId: string): Promise<void> {
  await requireRuntime().invoke('delete-host', { hostId })
}

export async function testConnection(input: { hostId?: string; host?: HostDraft }): Promise<{
  ok: boolean
  message: string
  latencyMs: number
}> {
  return requireRuntime().invoke('test-connection', input)
}

export async function execCommand(input: {
  hostId?: string
  host?: HostDraft
  command: string
  timeoutMs?: number
}): Promise<ExecResult> {
  return requireRuntime().invoke<ExecResult>('exec', input)
}

export function openSession(
  input: { hostId: string; sessionId: string; cols: number; rows: number },
  onEvent: (event: SessionEvent) => void
): Promise<BricklyInteraction<SessionEvent, { sessionId?: string; exitCode?: number }>> {
  return requireRuntime().interact<SessionEvent, { sessionId?: string; exitCode?: number }>(
    'open-session',
    input,
    { onEvent }
  )
}

export async function sftpList(input: {
  hostId: string
  sessionId?: string
  path?: string
}): Promise<SftpListResult> {
  return requireRuntime().invoke<SftpListResult>('sftp-list', input)
}

export function callSftpUpload(
  input: {
    hostId: string
    sessionId?: string
    localPath: string
    remoteDir?: string
    overwrite?: boolean
  },
  onEvent: (event: SftpProgressEvent) => void,
  signal?: AbortSignal
): Promise<SftpTransferResult> {
  return requireRuntime().call<SftpTransferResult>('sftp-upload', input, { onEvent, signal })
}

export function callSftpDownload(
  input: {
    hostId: string
    sessionId?: string
    remotePath: string
    localDir: string
    overwrite?: boolean
  },
  onEvent: (event: SftpProgressEvent) => void,
  signal?: AbortSignal
): Promise<SftpTransferResult> {
  return requireRuntime().call<SftpTransferResult>('sftp-download', input, { onEvent, signal })
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
