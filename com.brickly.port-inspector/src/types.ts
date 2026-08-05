/**
 * 端口占用查询与进程管理 - 类型定义文件
 */

export type ProtocolFilter = 'all' | 'tcp' | 'udp'
export type Mode = 'port' | 'list'

/** 单条端口连接进程记录 */
export interface PortProcessRow {
  protocol: 'tcp' | 'udp'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number | null
  state: string
  pid: number | null
  processName: string | null
  executablePath?: string | null
}

/** 端口查询返回结果 */
export interface PortQueryResult {
  platform: string
  protocol: ProtocolFilter
  query: string
  count: number
  generatedAt: string
  rows: PortProcessRow[]
  method?: string
}

/** 结束进程返回结果 */
export interface KillProcessResult {
  ok: boolean
  pid: number
  force: boolean
  alreadyExited?: boolean
  method?: string
  processName: string | null
  platform: string
  killedAt: string
}

/** 进程详细信息 */
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

/** Brickly 全局 Bridge API */
export interface BricklyApi {
  brickId: string
  instanceId?: string
  invoke(commandId: string, input: Record<string, unknown>): Promise<unknown>
}

/** 表格排序字段与顺序 */
export type SortField = 'localPort' | 'protocol' | 'processName' | 'pid' | 'state'
export type SortOrder = 'asc' | 'desc'

/** 常用端口预设项 */
export interface PresetPort {
  port: number
  label: string
  tag?: string
}

declare global {
  interface Window {
    brickly?: BricklyApi
  }
}
