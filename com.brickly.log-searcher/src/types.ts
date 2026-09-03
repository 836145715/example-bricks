import type { HighlightKeywordTextMap } from './domain/highlight'
import type { RemoteLogFile } from './domain/logFiles'
import type { FileDateFilter } from './domain/paths'

export const LOG_ROW_HEIGHT = 22
export const WRAPPED_LOG_ROW_ESTIMATE_HEIGHT = 36

export type { FileDateFilter }

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

export const BYTES_PER_MB = 1024 * 1024

export function megabytesFromTailBytes(tailBytes: number): number {
  if (!Number.isFinite(tailBytes) || tailBytes <= 0) return 0
  return Math.round(tailBytes / BYTES_PER_MB)
}

export function tailBytesFromMegabytes(megabytes: number): number {
  if (!Number.isFinite(megabytes) || megabytes <= 0) return 0
  return Math.floor(megabytes) * BYTES_PER_MB
}

export const DEFAULT_GREP_ARGS: GrepArgs = {
  ignoreCase: true,
  invert: false,
  wordRegexp: false,
  regexp: false,
  contextA: 0,
  contextB: 0,
  contextC: 0,
  onlyMatch: false,
  tailBytes: 0
}

/** 检索表单输入草稿（按服务器隔离） */
export interface QueryDraft {
  pattern: string
  filters: FilterConfig[]
  grepArgs: GrepArgs
  selectedFiles: string[]
  dateFilter: FileDateFilter
}

/** 远程日志文件列表加载状态 */
export interface ServerFilesState {
  availableFiles: RemoteLogFile[]
  status: FileListStatus
}

/** 服务器当前检索任务状态 */
export interface ServerSearchJob {
  runId: string
  isSearching: boolean
  tabs: string[]
  activeTabId: string
  fileStates: Record<string, FileSearchState>
}

/** 结果内查找状态（Ctrl+F） */
export interface ServerFindState {
  keyword: string
  showBar: boolean
  loading: boolean
  results: Record<string, FindResult | null>
}

/** 单个服务器的完整工作区状态 */
export interface ServerWorkspace {
  draft: QueryDraft
  files: ServerFilesState
  job: ServerSearchJob
  find: ServerFindState
}

/** 全局 Workspace 总状态树 */
export interface WorkspaceState {
  servers: ServerConfig[]
  activeServerId: string
  workspaces: Record<string, ServerWorkspace>
  resultWindows: Record<string, ResultWindowState>
}

