import type {
  FileSearchState,
  FileSearchStatus,
  ResultWindowState,
  ServerWorkspace,
  WorkspaceState
} from '../types'
import type { WorkspaceAction } from './workspaceActions'
import {
  areFileSearchStateMapsEqual,
  areFileSearchStatesEqual,
  areParsedLogLinesEqual,
  areStringArraysEqual,
  createDefaultServerWorkspace,
  isCurrentSearchRun,
  isServerScopeKey,
  makeScopeKey,
  parseScopeKey
} from './workspaceHelpers'

/** 获取或创建指定服务器的工作区 */
function ensureWorkspace(
  workspaces: Record<string, ServerWorkspace>,
  serverId: string
): ServerWorkspace {
  return workspaces[serverId] ?? createDefaultServerWorkspace()
}

/** 核心工作区状态 Reducer（纯函数） */
export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction
): WorkspaceState {
  switch (action.type) {
    case 'SET_SERVERS': {
      const nextWorkspaces = { ...state.workspaces }
      for (const server of action.servers) {
        if (!nextWorkspaces[server.id]) {
          nextWorkspaces[server.id] = createDefaultServerWorkspace()
        }
      }
      return {
        ...state,
        servers: action.servers,
        workspaces: nextWorkspaces
      }
    }

    case 'SELECT_SERVER': {
      if (state.activeServerId === action.serverId) return state
      return {
        ...state,
        activeServerId: action.serverId,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: ensureWorkspace(state.workspaces, action.serverId)
        }
      }
    }

    case 'DELETE_SERVER': {
      const serverId = action.serverId
      const nextServers = state.servers.filter(s => s.id !== serverId)
      const nextWorkspaces = { ...state.workspaces }
      delete nextWorkspaces[serverId]

      const nextResultWindows = Object.fromEntries(
        Object.entries(state.resultWindows).filter(([scopeKey]) => !isServerScopeKey(scopeKey, serverId))
      )

      let nextActiveServerId = state.activeServerId
      if (nextActiveServerId === serverId) {
        nextActiveServerId = nextServers[0]?.id || ''
      }

      return {
        ...state,
        servers: nextServers,
        activeServerId: nextActiveServerId,
        workspaces: nextWorkspaces,
        resultWindows: nextResultWindows
      }
    }

    case 'UPDATE_DRAFT': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            draft: { ...ws.draft, ...action.draft }
          }
        }
      }
    }

    case 'SET_FILES': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            files: {
              availableFiles: action.files,
              status: action.status
            }
          }
        }
      }
    }

    case 'SET_FILE_LIST_STATUS': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            files: {
              ...ws.files,
              status: action.status
            }
          }
        }
      }
    }

    case 'START_SEARCH': {
      const { serverId, tabs } = action
      const ws = ensureWorkspace(state.workspaces, serverId)

      const initialFileStates: Record<string, FileSearchState> = {}
      for (const tabId of tabs) {
        initialFileStates[tabId] = {
          count: 0,
          durationMs: 0,
          active: false,
          status: 'queued'
        }
      }

      const nextResultWindows = { ...state.resultWindows }
      // 清理该 server 不在本次 tabs 中的旧结果
      for (const scopeKey of Object.keys(nextResultWindows)) {
        if (isServerScopeKey(scopeKey, serverId)) {
          delete nextResultWindows[scopeKey]
        }
      }
      for (const tabId of tabs) {
        const scopeKey = makeScopeKey(serverId, tabId)
        nextResultWindows[scopeKey] = {
          runId: '',
          tabId,
          offset: 0,
          limit: 0,
          total: 0,
          lines: [],
          status: 'queued',
          durationMs: 0,
          loading: false
        }
      }

      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [serverId]: {
            ...ws,
            job: {
              runId: '',
              isSearching: true,
              tabs,
              activeTabId: tabs[0] || '',
              fileStates: initialFileStates
            }
          }
        },
        resultWindows: nextResultWindows
      }
    }

    case 'SET_SEARCH_RUN_ID': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            job: {
              ...ws.job,
              runId: action.runId
            }
          }
        }
      }
    }

    case 'UPDATE_SEARCH_STATE': {
      const { payload } = action
      if (!payload?.serverId || !payload.runId) return state
      const serverId = payload.serverId
      const ws = ensureWorkspace(state.workspaces, serverId)

      let nextTabs = ws.job.tabs
      let nextActiveTabId = ws.job.activeTabId
      if (Array.isArray(payload.tabs) && payload.tabs.length > 0) {
        if (!areStringArraysEqual(nextTabs, payload.tabs)) {
          nextTabs = payload.tabs
          if (!nextTabs.includes(nextActiveTabId)) {
            nextActiveTabId = nextTabs[0]
          }
        }
      }

      let nextFileStates = { ...ws.job.fileStates }
      let nextIsSearching = ws.job.isSearching

      if (Array.isArray(payload.files)) {
        const parsedServerState = Object.fromEntries(
          payload.files.map(file => [
            file.tabId,
            {
              count: file.total,
              durationMs: file.durationMs,
              active: !!file.active,
              status: file.status,
              message: file.message,
              truncated: !!file.truncated
            } satisfies FileSearchState
          ])
        )
        if (!areFileSearchStateMapsEqual(nextFileStates, parsedServerState)) {
          nextFileStates = parsedServerState
        }
        nextIsSearching = payload.status === 'searching' || payload.files.some(file => file.active)
      } else if (payload.tabId) {
        const current = nextFileStates[payload.tabId] ?? {
          count: 0,
          durationMs: 0,
          active: false,
          status: 'idle' as FileSearchStatus
        }
        const nextState = {
          ...current,
          count: payload.total,
          durationMs: payload.durationMs,
          active: !!payload.active,
          status: payload.status,
          message: payload.message,
          truncated: !!payload.truncated
        }
        if (!areFileSearchStatesEqual(current, nextState)) {
          nextFileStates[payload.tabId] = nextState
        }
      }

      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [serverId]: {
            ...ws,
            job: {
              ...ws.job,
              runId: payload.runId,
              tabs: nextTabs,
              activeTabId: nextActiveTabId,
              fileStates: nextFileStates,
              isSearching: nextIsSearching
            }
          }
        }
      }
    }

    case 'FINISH_SEARCH': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      let nextFileStates = ws.job.fileStates
      if (action.error) {
        nextFileStates = Object.fromEntries(
          Object.entries(nextFileStates).map(([tabId, state]) => [
            tabId,
            { ...state, active: false, status: 'error' as FileSearchStatus, message: action.error || '未知错误' }
          ])
        )
      }
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            job: {
              ...ws.job,
              isSearching: false,
              fileStates: nextFileStates
            }
          }
        }
      }
    }

    case 'CANCEL_SEARCH': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      const nextFileStates = Object.fromEntries(
        Object.entries(ws.job.fileStates).map(([tabId, state]) => [
          tabId,
          { ...state, active: false, status: 'cancelled' as FileSearchStatus }
        ])
      )
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            job: {
              ...ws.job,
              isSearching: false,
              fileStates: nextFileStates
            }
          }
        }
      }
    }

    case 'SET_ACTIVE_TAB': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      if (ws.job.activeTabId === action.tabId) return state
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            job: {
              ...ws.job,
              activeTabId: action.tabId
            }
          }
        }
      }
    }

    case 'SET_RESULT_WINDOW': {
      const { scopeKey, window } = action
      const { serverId, tabId: scopeTabId } = parseScopeKey(scopeKey)
      const tabId = scopeTabId || window.tabId
      if (!isCurrentSearchRun(state, serverId, window.runId)) {
        return state
      }

      const currentWindow = state.resultWindows[scopeKey]
      if (
        currentWindow
        && currentWindow.runId === window.runId
        && currentWindow.tabId === window.tabId
        && currentWindow.offset === window.offset
        && currentWindow.limit === window.limit
        && currentWindow.total === window.total
        && currentWindow.status === window.status
        && currentWindow.message === window.message
        && currentWindow.durationMs === window.durationMs
        && !!currentWindow.truncated === !!window.truncated
        && currentWindow.loading === window.loading
        && areParsedLogLinesEqual(currentWindow.lines, window.lines)
      ) {
        return state
      }

      const nextWorkspaces = { ...state.workspaces }
      if (serverId && nextWorkspaces[serverId]) {
        const ws = nextWorkspaces[serverId]
        const currentFileState = ws.job.fileStates[tabId]
        const nextFileState: FileSearchState = {
          count: window.total,
          durationMs: window.durationMs,
          status: window.status,
          message: window.message,
          truncated: !!window.truncated,
          active: window.status === 'searching'
        }
        if (!currentFileState || !areFileSearchStatesEqual(currentFileState, nextFileState)) {
          nextWorkspaces[serverId] = {
            ...ws,
            job: {
              ...ws.job,
              fileStates: {
                ...ws.job.fileStates,
                [tabId]: nextFileState
              }
            }
          }
        }
      }

      return {
        ...state,
        workspaces: nextWorkspaces,
        resultWindows: {
          ...state.resultWindows,
          [scopeKey]: window
        }
      }
    }

    case 'SET_RESULT_WINDOW_LOADING': {
      const { serverId } = parseScopeKey(action.scopeKey)
      if (!isCurrentSearchRun(state, serverId, action.runId)) return state
      const current = state.resultWindows[action.scopeKey]
      if (!current || current.loading === action.loading) return state
      if (current.runId && current.runId !== action.runId) return state
      return {
        ...state,
        resultWindows: {
          ...state.resultWindows,
          [action.scopeKey]: {
            ...current,
            loading: action.loading
          }
        }
      }
    }

    case 'SET_RESULT_WINDOW_ERROR': {
      const { serverId } = parseScopeKey(action.scopeKey)
      if (!isCurrentSearchRun(state, serverId, action.runId)) return state
      const current = state.resultWindows[action.scopeKey]
      if (!current) return state
      if (current.runId && current.runId !== action.runId) return state
      return {
        ...state,
        resultWindows: {
          ...state.resultWindows,
          [action.scopeKey]: {
            ...current,
            loading: false,
            status: 'error',
            message: action.error
          }
        }
      }
    }

    case 'CLEAR_SERVER_RESULTS': {
      const serverId = action.serverId
      const ws = ensureWorkspace(state.workspaces, serverId)
      const nextResultWindows = Object.fromEntries(
        Object.entries(state.resultWindows).filter(([scopeKey]) => !isServerScopeKey(scopeKey, serverId))
      )
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [serverId]: {
            ...ws,
            job: {
              runId: '',
              isSearching: false,
              tabs: [],
              activeTabId: '',
              fileStates: {}
            }
          }
        },
        resultWindows: nextResultWindows
      }
    }

    case 'UPDATE_FIND_STATE': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            find: {
              ...ws.find,
              ...action.find
            }
          }
        }
      }
    }

    case 'SET_FIND_RESULT': {
      const ws = ensureWorkspace(state.workspaces, action.serverId)
      return {
        ...state,
        workspaces: {
          ...state.workspaces,
          [action.serverId]: {
            ...ws,
            find: {
              ...ws.find,
              results: {
                ...ws.find.results,
                [action.scopeKey]: action.result
              }
            }
          }
        }
      }
    }

    default:
      return state
  }
}
