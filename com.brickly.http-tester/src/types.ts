export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface NameValue {
  name: string
  value: string
}

export interface SendInput {
  method: HttpMethod
  url: string
  headers?: NameValue[] | Record<string, string>
  query?: NameValue[] | Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface SendResult {
  ok: boolean
  status: number
  statusText: string
  durationMs: number
  finalUrl: string
  contentType: string
  headers: Record<string, string>
  body: string
  bodySize: number
  truncated: boolean
}

export interface HistoryItem {
  id: string
  at: number
  method: HttpMethod
  url: string
  headers: NameValue[]
  query: NameValue[]
  body: string
  timeoutMs: number
  status?: number
  durationMs?: number
  error?: string
}
