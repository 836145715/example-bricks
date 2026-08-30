import type { HighlightKeywordTextMap } from './domain/highlight'
import type { RemoteLogFile } from './domain/logFiles'

export interface LogFileConfig {
  path: string
  enabled: boolean
}

export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  user: string
  authType: 'password' | 'key'
  password?: string
  keyPath?: string
  keyText?: string
  logs: LogFileConfig[]
}

export interface FilterConfig {
  pattern: string
  regexp: boolean
  ignoreCase: boolean
  invert: boolean
  wordRegexp: boolean
}

export interface GrepArgs {
  ignoreCase: boolean
  invert: boolean
  wordRegexp: boolean
  regexp: boolean
  contextA: number
  contextB: number
  contextC: number
  onlyMatch: boolean
  maxCount: number
  showLineNum: boolean
  showFilename: boolean
  fromTail: boolean
  tailLines: number
  tailBytes: number
  filters?: FilterConfig[]
}

export interface ParsedLogLine {
  id: string
  index: number
  file: string
  content: string
  isContext: boolean
  error?: string
  matches?: Array<[number, number]>
}

export const FALLBACK_RESULTS_SCOPE = '__fallback__'

export type FileSearchStatus = 'idle' | 'queued' | 'searching' | 'success' | 'error' | 'cancelled' | 'done'
export type FileListStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ConnectionTestStatus = 'idle' | 'testing' | 'success' | 'error'

export interface FileSearchState {
  count: number
  durationMs: number
  active: boolean
  status: FileSearchStatus
  message?: string
  truncated?: boolean
}

export interface SearchFileStatePayload {
  tabId: string
  total: number
  status: FileSearchStatus
  message?: string
  durationMs: number
  truncated?: boolean
  active?: boolean
}

export interface SearchStatePayload {
  serverId: string
  runId: string
  tabId?: string
  tabs?: string[]
  files?: SearchFileStatePayload[]
  status: FileSearchStatus
  message?: string
  total: number
  durationMs: number
  truncated?: boolean
  active?: boolean
}

export interface BricklySearchEvent {
  type?: string
  progress?: number
  message?: string
  searchState?: SearchStatePayload
}

export interface PeekResult {
  runId: string
  tabId: string
  total: number
  offset: number
  lines: Array<{
    index: number
    text: string
    matches?: Array<[number, number]>
    file?: string
    isContext?: boolean
    error?: string
  }>
  status: FileSearchStatus
  message?: string
  durationMs: number
  truncated?: boolean
}

export interface FindResult {
  runId: string
  tabId: string
  keyword: string
  total: number
  ordinal: number
  lineIndex: number
  start: number
  end: number
  status: FileSearchStatus
  message?: string
  durationMs: number
  truncated?: boolean
}

export interface ResultWindowState {
  runId: string
  tabId: string
  offset: number
  limit: number
  total: number
  lines: ParsedLogLine[]
  status: FileSearchStatus
  message?: string
  durationMs: number
  truncated?: boolean
  loading: boolean
}

export interface ConnectionTestState {
  status: ConnectionTestStatus
  message: string
}

export type { HighlightKeywordTextMap, RemoteLogFile }

export const DEFAULT_TAIL_BYTES = 20 * 1024 * 1024

export const TAIL_BYTE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 10 * 1024 * 1024, label: '最近 10 MB' },
  { value: 20 * 1024 * 1024, label: '最近 20 MB' },
  { value: 50 * 1024 * 1024, label: '最近 50 MB' },
  { value: 100 * 1024 * 1024, label: '最近 100 MB' },
  { value: 0, label: '整个文件' }
]

export const DEFAULT_GREP_ARGS: GrepArgs = {
  ignoreCase: true,
  invert: false,
  wordRegexp: false,
  regexp: false,
  contextA: 0,
  contextB: 0,
  contextC: 0,
  onlyMatch: false,
  maxCount: 0,
  showLineNum: false,
  showFilename: false,
  fromTail: false,
  tailLines: 1000,
  tailBytes: DEFAULT_TAIL_BYTES
}
