export type PathKind = 'file' | 'directory'
export type HolderSource = 'restart-manager' | 'handle-scan' | 'process-ref' | 'lsof'
export type Tone = 'idle' | 'ok' | 'warn' | 'err' | 'busy'
export type SortField = 'processName' | 'pid' | 'sources' | 'applicationType' | 'startedAt'
export type SortOrder = 'asc' | 'desc'

export interface Holder {
  pid: number
  startKey: string
  processName: string
  applicationType: string
  status: number
  restartable: boolean
  sessionId: number
  startedAt: string
  sources: HolderSource[]
}

export interface ProbeResult {
  path: string
  kind: PathKind
  count: number
  holders: Holder[]
  deepUsed: boolean
  notes?: string[]
  probedAt: string
}

export interface ProcessDetails {
  pid: number
  startKey: string
  processName: string
  executablePath: string
  commandLine: string
  user: string
  parentPid: number
  sessionId: number
  startedAt: string
  inspectedAt: string
}

export interface StopResult {
  ok: boolean
  pid: number
  startKey: string
  processName: string
  force: boolean
  alreadyExited: boolean
  stoppedAt: string
}

export interface PresetTarget {
  label: string
  path: string
  tag?: string
}

export interface ConfirmTarget {
  pid: number
  startKey: string
  processName: string
}

export interface BricklyWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizeChange(listener: (maximized: boolean) => void): () => void
  close(): Promise<void>
}

export interface BricklyApi {
  brickId: string
  instanceId?: string
  window?: BricklyWindowApi
  closeWindow?(): void
  invoke(commandId: string, input: Record<string, unknown>): Promise<unknown>
}

export interface HoldProbePreloadApi {
  pickFile(): Promise<string | undefined>
  pickDirectory(): Promise<string | undefined>
  getPathForFile(file: File): string
}

declare global {
  interface Window {
    brickly?: BricklyApi
    holdProbePreload?: HoldProbePreloadApi
  }
}
