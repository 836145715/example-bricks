export type ProtocolFilter = 'all' | 'tcp' | 'udp'

export interface PortProcessRow {
  protocol: 'tcp' | 'udp'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number | null
  state: string
  pid: number | null
  processName: string | null
}

export interface PortQueryResult {
  platform: string
  protocol: ProtocolFilter
  query: string
  count: number
  generatedAt: string
  rows: PortProcessRow[]
}

export interface KillProcessResult {
  ok: boolean
  pid: number
  force: boolean
  processName: string | null
  platform: string
  killedAt: string
}

export interface ProcessDetails {
  ok: boolean
  platform: string
  pid: number
  parentPid: number | null
  processName: string | null
  executablePath: string | null
  commandLine: string | null
  workingDirectory: string | null
  user: string | null
  state: string | null
  startedAt: string | null
  elapsed: string | null
  inspectedAt: string
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
