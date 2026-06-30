export type RecordType = 'a' | 'aaaa' | 'cname' | 'mx' | 'ns' | 'txt'
export type DnsServerSelection = 'auto' | 'google' | 'cloudflare' | 'ali' | 'tencent' | 'system'

export interface DnsRecord {
  type: string
  address?: string
  value?: string
  ttl?: number
  priority?: number
  exchange?: string
}

export interface ServerResult {
  serverKey: string
  serverLabel: string
  serverAddress: string
  recordType: string
  records: DnsRecord[]
  recordCount: number
  elapsedMs: number
  ok: boolean
  error: string | null
}

export interface ResolveResult {
  domain: string
  recordType: string
  serverSelection: string
  serverCount: number
  results: ServerResult[]
  uniqueIps: string[]
  uniqueIpCount: number
  totalRecords: number
  generatedAt: string
}

export interface ResolveAllResult {
  domain: string
  serverSelection: string
  serverCount: number
  byType: Record<string, ServerResult[]>
  uniqueIps: string[]
  uniqueIpCount: number
  totalRecords: number
  generatedAt: string
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
