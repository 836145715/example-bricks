import type {
  FileSearchState,
  ParsedLogLine,
  QueryDraft,
  ServerWorkspace,
  WorkspaceState
} from '../types'
import { DEFAULT_GREP_ARGS } from '../types'
import { DEFAULT_FILE_DATE_FILTER } from '../domain/paths'

/** 比较两个字符串数组是否内容一致 */
export const areStringArraysEqual = (left: string[], right: string[]): boolean => {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/** 比较两个文件检索状态是否一致 */
export const areFileSearchStatesEqual = (left: FileSearchState, right: FileSearchState): boolean => {
  return left.count === right.count
    && left.durationMs === right.durationMs
    && left.active === right.active
    && left.status === right.status
    && left.message === right.message
    && !!left.truncated === !!right.truncated
}

/** 比较文件检索状态 Map 是否一致 */
export const areFileSearchStateMapsEqual = (
  left: Record<string, FileSearchState>,
  right: Record<string, FileSearchState>
): boolean => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (!areStringArraysEqual(leftKeys, rightKeys)) return false
  return leftKeys.every(key => areFileSearchStatesEqual(left[key], right[key]))
}

/** 比较已解析的日志行列表是否一致 */
export const areParsedLogLinesEqual = (left: ParsedLogLine[], right: ParsedLogLine[]): boolean => {
  if (left.length !== right.length) return false
  return left.every((line, index) => {
    const other = right[index]
    return line.id === other.id
      && line.index === other.index
      && line.content === other.content
      && line.error === other.error
      && line.isContext === other.isContext
  })
}

/** 生成 serverId + tabId 唯一 scopeKey */
export const makeScopeKey = (serverId: string, tabId: string): string => `${serverId}::${tabId}`

/** 检查 scopeKey 是否属于某服务器 */
export const isServerScopeKey = (scopeKey: string, serverId: string): boolean => scopeKey.startsWith(`${serverId}::`)

export const parseScopeKey = (scopeKey: string): { serverId: string; tabId: string } => {
  const separator = scopeKey.indexOf('::')
  if (separator < 0) {
    return { serverId: scopeKey, tabId: '' }
  }
  return {
    serverId: scopeKey.slice(0, separator),
    tabId: scopeKey.slice(separator + 2)
  }
}

export const isCurrentSearchRun = (
  state: WorkspaceState,
  serverId: string,
  runId: string
): boolean => {
  if (!serverId || !runId) return false
  return state.workspaces[serverId]?.job.runId === runId
}

/** 创建默认的查询草稿 */
export function createDefaultQueryDraft(): QueryDraft {
  return {
    pattern: '',
    filters: [],
    grepArgs: { ...DEFAULT_GREP_ARGS },
    selectedFiles: [],
    dateFilter: { ...DEFAULT_FILE_DATE_FILTER }
  }
}

/** 创建默认的服务器工作区状态 */
export function createDefaultServerWorkspace(): ServerWorkspace {
  return {
    draft: createDefaultQueryDraft(),
    files: {
      availableFiles: [],
      status: 'idle'
    },
    job: {
      runId: '',
      isSearching: false,
      tabs: [],
      activeTabId: '',
      fileStates: {}
    },
    find: {
      keyword: '',
      showBar: false,
      loading: false,
      results: {}
    }
  }
}

/** 初始化总工作区状态 */
export function createInitialWorkspaceState(): WorkspaceState {
  return {
    servers: [],
    activeServerId: '',
    workspaces: {},
    resultWindows: {}
  }
}
