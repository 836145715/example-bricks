import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { ConfigModal } from './components/ConfigModal'
import { ResultsPane } from './components/ResultsPane'
import { SearchToolbar } from './components/SearchToolbar'
import { ServerSidebar } from './components/ServerSidebar'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import {
  DEFAULT_STATUS_HIGHLIGHT_KEYWORDS,
  HighlightKeywordTextMap,
  StatusHighlightKind,
  buildStatusHighlightRules,
  countFindMatches,
  escapeRegExp
} from './domain/highlight'
import {
  getDefaultSelectedFiles,
  isSearchableLogFile,
  normalizeRemoteLogFiles,
  sortRemoteLogFilesByModifiedAt,
  type RemoteLogFile
} from './domain/logFiles'
import {
  getJumpPeekWindow,
  type JumpAlign
} from './virtualJump'
import { isEmptyCompletedResultTab, shouldShowResultTab } from './resultDisplay'
import {
  BricklySearchEvent,
  DEFAULT_GREP_ARGS,
  FALLBACK_RESULTS_SCOPE,
  FileListStatus,
  FileSearchState,
  FileSearchStatus,
  FilterConfig,
  FindResult,
  GrepArgs,
  LogFileConfig,
  ParsedLogLine,
  PeekResult,
  ResultWindowState,
  SearchStatePayload,
  ServerConfig
} from './types'
import {
  DEFAULT_FILE_DATE_FILTER,
  dateFilterPreset,
  filterFilesByModifiedDate,
  isDateFilterActive,
  normalizeDateFilter,
  type FileDateFilter,
  type FileDatePreset,
  type RemoteBrowseResult
} from './domain/paths'
import type { BricklyStartedHandle } from '@syllm/brickly-ui'

const LOG_ROW_HEIGHT = 22
const WRAPPED_LOG_ROW_ESTIMATE_HEIGHT = 36
const VIRTUAL_OVERSCAN_ROWS = 12
const PEEK_MAX_LIMIT = 1000
const PEEK_DEBOUNCE_MS = 35
const LOG_WRAP_PREFERENCE_KEY = 'log_searcher_wrap_lines'

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

const areFileSearchStatesEqual = (left: FileSearchState, right: FileSearchState): boolean => {
  return left.count === right.count
    && left.durationMs === right.durationMs
    && left.active === right.active
    && left.status === right.status
    && left.message === right.message
    && !!left.truncated === !!right.truncated
}

const areFileSearchStateMapsEqual = (
  left: Record<string, FileSearchState>,
  right: Record<string, FileSearchState>
): boolean => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (!areStringArraysEqual(leftKeys, rightKeys)) return false
  return leftKeys.every(key => areFileSearchStatesEqual(left[key], right[key]))
}

const areParsedLogLinesEqual = (left: ParsedLogLine[], right: ParsedLogLine[]): boolean => {
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

const makePeekSignature = (
  runId: string,
  tabId: string,
  offset: number,
  limit: number,
  totalHint: number
): string => `${runId}::${tabId}::${offset}::${limit}::${totalHint}`

const fileListLoadAttempts = 3
const fileListRetryDelayMs = 500

export function App() {
  const [servers, setServers] = useState<ServerConfig[]>([])
  const [activeServerId, setActiveServerId] = useState<string>('')
  
  // 各服务器独立的状态 Map
  const [searchPatterns, setSearchPatterns] = useState<Record<string, string>>({})
  const [extraFiltersMap, setExtraFiltersMap] = useState<Record<string, FilterConfig[]>>({})
  const [grepArgsMap, setGrepArgsMap] = useState<Record<string, GrepArgs>>({})
  const [resultWindowMap, setResultWindowMap] = useState<Record<string, ResultWindowState>>({})
  const [serverRunIdsMap, setServerRunIdsMap] = useState<Record<string, string>>({})
  const [isSearchingMap, setIsSearchingMap] = useState<Record<string, boolean>>({})
  const [resultTabsMap, setResultTabsMap] = useState<Record<string, string[]>>({})
  const [activeResultTabsMap, setActiveResultTabsMap] = useState<Record<string, string>>({})
  const [fileSearchStateMap, setFileSearchStateMap] = useState<Record<string, Record<string, FileSearchState>>>({})
  // 检索执行时锁定的 pattern 和 args，用于渲染高亮（不随输入框变化）
  const [committedPatterns, setCommittedPatterns] = useState<Record<string, string>>({})
  const [committedGrepArgs, setCommittedGrepArgs] = useState<Record<string, GrepArgs>>({})

  // Ctrl+F 查找高亮（按服务器页面独立，切换连接不串词/不串开关）
  const [findKeywordMap, setFindKeywordMap] = useState<Record<string, string>>({})
  const [showFindBarMap, setShowFindBarMap] = useState<Record<string, boolean>>({})
  const [findResultMap, setFindResultMap] = useState<Record<string, FindResult | null>>({})
  const [findLoadingMap, setFindLoadingMap] = useState<Record<string, boolean>>({})
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const runtimeRef = useRef<BricklyStartedHandle | null>(null)

  const [statusMessage, setStatusMessage] = useState<string>('就绪')
  const [statusDot, setStatusDot] = useState<'active' | 'warn' | 'error' | ''>('active')
  const [toastMessage, setToastMessage] = useState<string>('')

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(''), 2500)
  }

  // 虚拟滚动状态与 Ref
  const consoleContainerRef = useRef<HTMLElement | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const visibleRangeRef = useRef({ startIndex: 0, endIndex: 0 })
  const scrollTopRef = useRef(0)
  const [wrapLines, setWrapLines] = useState<boolean>(() => {
    return localStorage.getItem(LOG_WRAP_PREFERENCE_KEY) !== 'false'
  })

  // 偏好记忆配置
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('log_searcher_sidebar_collapsed') === 'true'
  })
  const [highlightPanelOpen, setHighlightPanelOpen] = useState<boolean>(() => {
    return localStorage.getItem('log_searcher_highlight_panel_open') === 'true'
  })
  const [highlightKeywords, setHighlightKeywords] = useState<HighlightKeywordTextMap>(() => {
    try {
      const stored = localStorage.getItem('log_searcher_highlight_keywords')
      if (!stored) return DEFAULT_STATUS_HIGHLIGHT_KEYWORDS
      return { ...DEFAULT_STATUS_HIGHLIGHT_KEYWORDS, ...JSON.parse(stored) }
    } catch {
      return DEFAULT_STATUS_HIGHLIGHT_KEYWORDS
    }
  })

  const handleToggleSidebarCollapsed = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('log_searcher_sidebar_collapsed', String(next))
      return next
    })
  }

  const handleToggleHighlightPanel = () => {
    setHighlightPanelOpen(prev => {
      const next = !prev
      localStorage.setItem('log_searcher_highlight_panel_open', String(next))
      return next
    })
  }

  const handleToggleWrapLines = () => {
    setWrapLines(prev => {
      const next = !prev
      localStorage.setItem(LOG_WRAP_PREFERENCE_KEY, String(next))
      return next
    })
  }

  const updateHighlightKeywords = (kind: StatusHighlightKind, value: string) => {
    setHighlightKeywords(prev => {
      const next = { ...prev, [kind]: value }
      localStorage.setItem('log_searcher_highlight_keywords', JSON.stringify(next))
      return next
    })
  }

  const resetHighlightKeywords = () => {
    setHighlightKeywords(DEFAULT_STATUS_HIGHLIGHT_KEYWORDS)
    localStorage.setItem('log_searcher_highlight_keywords', JSON.stringify(DEFAULT_STATUS_HIGHLIGHT_KEYWORDS))
  }

  // 配置侧边栏状态
  const [configPanelOpen, setConfigPanelOpen] = useState<boolean>(false)
  const [editingServer, setEditingServer] = useState<ServerConfig | null>(null)
  const [connectionTest, setConnectionTest] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error'
    message: string
  }>({ status: 'idle', message: '' })

  // 日志多选控件状态与 Refs
  const [availableFilesMap, setAvailableFilesMap] = useState<Record<string, RemoteLogFile[]>>({})
  const [selectedFilesMap, setSelectedFilesMap] = useState<Record<string, string[]>>({})
  const [dateFilterMap, setDateFilterMap] = useState<Record<string, FileDateFilter>>({})
  const [fileListStatusMap, setFileListStatusMap] = useState<Record<string, FileListStatus>>({})
  const fileListRequestIDsRef = useRef<Record<string, number>>({})
  const fileListRetryTimersRef = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({})
  const dateFilterMapRef = useRef<Record<string, FileDateFilter>>({})
  const selectedFilesBeforeDateRef = useRef<Record<string, string[]>>({})

  useEffect(() => {
    dateFilterMapRef.current = dateFilterMap
  }, [dateFilterMap])

  useEffect(() => () => {
    for (const timer of Object.values(fileListRetryTimersRef.current)) {
      window.clearTimeout(timer)
    }
  }, [])

  const invokeSelf = <TResult = unknown>(commandId: string, input: Record<string, unknown> = {}) => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return Promise.reject(new Error('Runtime 尚未就绪，请稍后重试'))
    }
    return runtime.invoke<TResult>(commandId, input)
  }

  // 刷新拉取当前服务器下的日志文件列表
  const fetchAvailableFiles = async (serverId: string, attempt = 0, requestID?: number) => {
    if (!runtimeRef.current || !serverId) return

    let activeRequestID = requestID
    if (activeRequestID === undefined) {
      const retryTimer = fileListRetryTimersRef.current[serverId]
      if (retryTimer) {
        window.clearTimeout(retryTimer)
        delete fileListRetryTimersRef.current[serverId]
      }
      activeRequestID = (fileListRequestIDsRef.current[serverId] ?? 0) + 1
      fileListRequestIDsRef.current[serverId] = activeRequestID
    }
    setFileListStatusMap(prev => ({ ...prev, [serverId]: 'loading' }))

    try {
      const res = await invokeSelf('list_log_files', { serverId })
      if (fileListRequestIDsRef.current[serverId] !== activeRequestID) return
      const files = sortRemoteLogFilesByModifiedAt(
        normalizeRemoteLogFiles(res).filter(isSearchableLogFile)
      )
      const filesByPath = new Map(files.map(file => [file.path, file]))
      const sortedFiles = files
        .map(file => filesByPath.get(file.path))
        .filter((file): file is RemoteLogFile => file !== undefined)
      const sortedFilePaths = sortedFiles.map(file => file.path)
      setAvailableFilesMap(prev => ({ ...prev, [serverId]: sortedFiles }))
      setFileListStatusMap(prev => ({ ...prev, [serverId]: 'ready' }))

      // 有日期筛选时按最后修改时间重选；否则保留已有选择，首次加载用配置默认文件。
      const server = servers.find(s => s.id === serverId)
      if (server) {
        const dateFilter = dateFilterMapRef.current[serverId]
        if (isDateFilterActive(dateFilter)) {
          const matchedPaths = filterFilesByModifiedDate(sortedFiles, dateFilter).map(file => file.path)
          if (matchedPaths.length > 0) {
            setSelectedFilesMap(prev => ({ ...prev, [serverId]: matchedPaths }))
          }
        } else {
          setSelectedFilesMap(prev => {
            if (Object.prototype.hasOwnProperty.call(prev, serverId)) {
              return {
                ...prev,
                [serverId]: (prev[serverId] ?? []).filter(file => sortedFilePaths.includes(file))
              }
            }
            return {
              ...prev,
              [serverId]: getDefaultSelectedFiles(sortedFilePaths, server.logs)
            }
          })
        }
      }
    } catch (err: any) {
      if (fileListRequestIDsRef.current[serverId] !== activeRequestID) return
      console.error('fetch log files err:', err)
      if (attempt+1 < fileListLoadAttempts) {
        const delay = fileListRetryDelayMs * (attempt + 1)
        fileListRetryTimersRef.current[serverId] = window.setTimeout(() => {
          delete fileListRetryTimersRef.current[serverId]
          void fetchAvailableFiles(serverId, attempt + 1, activeRequestID)
        }, delay)
        return
      }
      setFileListStatusMap(prev => ({ ...prev, [serverId]: 'error' }))
    }
  }

  const activeServerListSignature = (() => {
    const server = servers.find(item => item.id === activeServerId)
    if (!server) return ''
    return [
      server.id,
      server.host,
      String(server.port),
      server.user,
      server.authType,
      server.password ?? '',
      server.keyPath ?? '',
      server.keyText ?? '',
      server.logs.map(log => log.path).join('\n')
    ].join('\u0001')
  })()

  // 仅在连接目标或日志路径变化时重新拉列表，改名称不会再走一遍 SSH。
  useEffect(() => {
    if (activeServerId && activeServerListSignature) {
      fetchAvailableFiles(activeServerId)
    }
  }, [activeServerId, activeServerListSignature])

  // 各服务器检索配置安全读取 Getter & Setter
  const getSearchPattern = (id: string): string => {
    return searchPatterns[id] ?? ''
  }

  const getGrepArgs = (id: string): GrepArgs => {
    return grepArgsMap[id] ?? DEFAULT_GREP_ARGS
  }

  const getDateFilter = (id: string): FileDateFilter => {
    return dateFilterMap[id] ?? DEFAULT_FILE_DATE_FILTER
  }

  const applyDateFilterSelection = (serverId: string, filter: FileDateFilter, files: RemoteLogFile[]) => {
    if (!isDateFilterActive(filter)) return
    const matched = filterFilesByModifiedDate(files, filter)
    if (matched.length === 0) {
      if (files.length > 0) {
        showToast('该日期范围内没有最后修改过的日志文件，已保留当前文件选择')
      }
      return
    }
    setSelectedFilesMap(prev => {
      if (!Object.prototype.hasOwnProperty.call(selectedFilesBeforeDateRef.current, serverId)) {
        selectedFilesBeforeDateRef.current[serverId] = prev[serverId] ?? []
      }
      return { ...prev, [serverId]: matched.map(file => file.path) }
    })
  }

  const handleDateFilterChange = (filter: FileDateFilter) => {
    if (!activeServerId) return
    const next = normalizeDateFilter(filter)
    setDateFilterMap(prev => ({ ...prev, [activeServerId]: next }))
    applyDateFilterSelection(activeServerId, next, availableFilesMap[activeServerId] || [])
  }

  const handleDateFilterPreset = (kind: FileDatePreset) => {
    handleDateFilterChange(dateFilterPreset(kind))
  }

  const handleClearDateFilter = () => {
    if (!activeServerId) return
    const restored = selectedFilesBeforeDateRef.current[activeServerId]
    delete selectedFilesBeforeDateRef.current[activeServerId]
    setDateFilterMap(prev => ({ ...prev, [activeServerId]: DEFAULT_FILE_DATE_FILTER }))
    if (restored) {
      setSelectedFilesMap(prev => ({ ...prev, [activeServerId]: restored }))
    }
  }

  const makeScopeKey = (serverId: string, tabId: string): string => {
    return `${serverId}::${tabId}`
  }

  const findServer = (serverId: string): ServerConfig | undefined => {
    return servers.find(server => server.id === serverId)
  }

  const isServerScopeKey = (scopeKey: string, serverId: string): boolean => {
    return scopeKey.startsWith(`${serverId}::`)
  }

  const getVisibleResultTabs = (serverId: string): string[] => {
    const states = fileSearchStateMap[serverId] ?? {}
    return (resultTabsMap[serverId] ?? []).filter(tabId => shouldShowResultTab(states[tabId]))
  }

  const getActiveResultTab = (serverId: string): string => {
    const visibleTabs = getVisibleResultTabs(serverId)
    const tabs = resultTabsMap[serverId] ?? []
    const activeTab = activeResultTabsMap[serverId]
    if (activeTab && visibleTabs.includes(activeTab)) return activeTab
    if (visibleTabs[0]) return visibleTabs[0]
    if (activeTab && tabs.includes(activeTab)) return activeTab
    return tabs[0] ?? FALLBACK_RESULTS_SCOPE
  }

  const getActiveScopeKey = (serverId: string): string => {
    return makeScopeKey(serverId, getActiveResultTab(serverId))
  }

  const activeTabId = getActiveResultTab(activeServerId)
  const currentScopeKey = activeServerId ? makeScopeKey(activeServerId, activeTabId) : ''
  const findKeyword = activeServerId ? (findKeywordMap[activeServerId] ?? '') : ''
  const showFindBar = activeServerId ? !!showFindBarMap[activeServerId] : false
  const findLoading = activeServerId ? !!findLoadingMap[activeServerId] : false

  const setFindKeywordForServer = (serverId: string, keyword: string) => {
    if (!serverId) return
    setFindKeywordMap(prev => {
      if ((prev[serverId] ?? '') === keyword) return prev
      return { ...prev, [serverId]: keyword }
    })
  }

  const setShowFindBarForServer = (serverId: string, open: boolean) => {
    if (!serverId) return
    setShowFindBarMap(prev => {
      if (!!prev[serverId] === open) return prev
      return { ...prev, [serverId]: open }
    })
  }

  const setFindLoadingForServer = (serverId: string, loading: boolean) => {
    if (!serverId) return
    setFindLoadingMap(prev => {
      if (!!prev[serverId] === loading) return prev
      return { ...prev, [serverId]: loading }
    })
  }

  const clearFindStateForServer = (serverId: string, scopeKey?: string) => {
    if (!serverId) return
    setShowFindBarForServer(serverId, false)
    setFindKeywordForServer(serverId, '')
    setFindLoadingForServer(serverId, false)
    if (scopeKey) {
      setFindResultMap(prev => {
        if (!prev[scopeKey]) return prev
        return { ...prev, [scopeKey]: null }
      })
    }
  }

  const getResultWindow = (scopeKey: string): ResultWindowState | undefined => {
    return resultWindowMap[scopeKey]
  }

  const getCurrentLogs = (): ParsedLogLine[] => {
    if (!activeServerId) return []
    return getResultWindow(getActiveScopeKey(activeServerId))?.lines ?? []
  }

  const getCurrentStats = (): { count: number; durationMs: number; truncated?: boolean } => {
    if (!activeServerId) return { count: 0, durationMs: 0 }
    const state = getFileSearchState(activeServerId, getActiveResultTab(activeServerId))
    return { count: state.count, durationMs: state.durationMs, truncated: state.truncated }
  }

  const getCurrentRunId = (serverId: string): string => {
    return serverRunIdsMap[serverId] ?? ''
  }

  const getIsSearching = (id: string): boolean => {
    return !!isSearchingMap[id]
  }

  const getResultTabs = (serverId: string): string[] => {
    return resultTabsMap[serverId] ?? []
  }

  const getFileSearchStates = (serverId: string): Record<string, FileSearchState> => {
    return fileSearchStateMap[serverId] ?? {}
  }

  const getFileSearchState = (serverId: string, tabId: string): FileSearchState => {
    return getFileSearchStates(serverId)[tabId] ?? {
      count: 0,
      durationMs: 0,
      active: false,
      status: 'idle'
    }
  }

  const updateGrepArgs = (id: string, fields: Partial<GrepArgs>) => {
    setGrepArgsMap(prev => ({
      ...prev,
      [id]: { ...getGrepArgs(id), ...fields }
    }))
  }

  const getExtraFilters = (id: string): FilterConfig[] => {
    return extraFiltersMap[id] ?? []
  }

  const handleAddExtraFilter = (serverId: string) => {
    if (!serverId) return
    setExtraFiltersMap(prev => ({
      ...prev,
      [serverId]: [
        ...(prev[serverId] ?? []),
        {
          pattern: '',
          regexp: false,
          ignoreCase: getGrepArgs(serverId).ignoreCase,
          invert: false,
          wordRegexp: false
        }
      ]
    }))
  }

  const handleUpdateExtraFilter = (serverId: string, index: number, fields: Partial<FilterConfig>) => {
    setExtraFiltersMap(prev => ({
      ...prev,
      [serverId]: (prev[serverId] ?? []).map((filter, i) => (i === index ? { ...filter, ...fields } : filter))
    }))
  }

  const handleRemoveExtraFilter = (serverId: string, index: number) => {
    setExtraFiltersMap(prev => ({
      ...prev,
      [serverId]: (prev[serverId] ?? []).filter((_, i) => i !== index)
    }))
  }

  // 检索 Session 的多实例隔离控制：服务器负责批次，文件 Tab 负责结果与滚动状态。
  interface SessionControl {
    streamHandle: { cancel(): void } | null
    searchStartTime: number
    scrollTop: number
    runId: number
    active: boolean
    scopeKey: string
    serverId: string
    tabId: string
  }

  const sessionsRef = useRef<Record<string, SessionControl>>({})
  const serverBatchRunIdsRef = useRef<Record<string, number>>({})
  const serverRunIdsRef = useRef<Record<string, string>>({})
  const peekTimersRef = useRef<Record<string, number>>({})
  const peekRequestSignaturesRef = useRef<Record<string, string>>({})
  const scrollPeekFrameRef = useRef<number | null>(null)
  const pendingJumpRef = useRef<Record<string, {
    runId: string
    targetIndex: number
    align: JumpAlign
    renderStart: number
    renderEnd: number
  }>>({})
  const [jumpEpoch, setJumpEpoch] = useState(0)

  const getOrCreateSessionRef = (scopeKey: string, serverId?: string, tabId?: string): SessionControl => {
    if (!sessionsRef.current[scopeKey]) {
      sessionsRef.current[scopeKey] = {
        streamHandle: null,
        searchStartTime: 0,
        scrollTop: 0,
        runId: 0,
        active: false,
        scopeKey,
        serverId: serverId ?? '',
        tabId: tabId ?? ''
      }
    } else {
      if (serverId !== undefined) sessionsRef.current[scopeKey].serverId = serverId
      if (tabId !== undefined) sessionsRef.current[scopeKey].tabId = tabId
    }
    return sessionsRef.current[scopeKey]
  }

  const clearPeekTrackingForServer = (serverId: string) => {
    for (const scopeKey of Object.keys(peekTimersRef.current)) {
      if (!isServerScopeKey(scopeKey, serverId)) continue
      window.clearTimeout(peekTimersRef.current[scopeKey])
      delete peekTimersRef.current[scopeKey]
    }
    for (const scopeKey of Object.keys(peekRequestSignaturesRef.current)) {
      if (isServerScopeKey(scopeKey, serverId)) {
        delete peekRequestSignaturesRef.current[scopeKey]
      }
    }
    for (const scopeKey of Object.keys(pendingJumpRef.current)) {
      if (isServerScopeKey(scopeKey, serverId)) {
        delete pendingJumpRef.current[scopeKey]
      }
    }
  }

  const updateFileSearchState = (
    serverId: string,
    tabId: string,
    fields: Partial<FileSearchState>
  ) => {
    setFileSearchStateMap(prev => {
      const current = prev[serverId]?.[tabId] ?? {
        count: 0,
        durationMs: 0,
        active: false,
        status: 'idle' as FileSearchStatus
      }
      const nextFileState = { ...current, ...fields }
      if (
        typeof fields.durationMs === 'number'
        && fields.durationMs <= 0
        && current.durationMs > 0
        && (fields.count ?? current.count) > 0
      ) {
        nextFileState.durationMs = current.durationMs
      }
      if (areFileSearchStatesEqual(current, nextFileState)) {
        return prev
      }
      return {
        ...prev,
        [serverId]: {
          ...(prev[serverId] ?? {}),
          [tabId]: nextFileState
        }
      }
    })
  }

  useEffect(() => {
    serverRunIdsRef.current = serverRunIdsMap
  }, [serverRunIdsMap])

  const finalizeSearchSession = (
    scopeKey: string,
    status: { type: 'success' | 'error' | 'cancelled' | 'done'; message?: string }
  ) => {
    const sess = getOrCreateSessionRef(scopeKey)
    sess.active = false
    sess.streamHandle = null
    if (sess.serverId) {
      const currentFileState = getFileSearchState(sess.serverId, sess.tabId)
      updateFileSearchState(sess.serverId, sess.tabId, {
        active: false,
        status: currentFileState.status === 'error' && status.type !== 'cancelled' ? 'error' : status.type,
        message: currentFileState.message || status.message
      })
    }
  }

  const toParsedLogLine = (scopeKey: string, runId: string, line: PeekResult['lines'][number]): ParsedLogLine => ({
    id: `log_${runId}_${scopeKey}_${line.index}`,
    index: line.index,
    file: line.file || '',
    content: line.text,
    isContext: !!line.isContext,
    error: line.error,
    matches: Array.isArray(line.matches) ? line.matches : []
  })

  const updateStateFromSearchPayload = (payload: SearchStatePayload) => {
    if (!payload?.serverId || !payload.runId) return
    const serverId = payload.serverId
    setServerRunIdsMap(prev => {
      if (prev[serverId] === payload.runId) return prev
      return { ...prev, [serverId]: payload.runId }
    })

    if (Array.isArray(payload.tabs) && payload.tabs.length > 0) {
      setResultTabsMap(prev => {
        if (areStringArraysEqual(prev[serverId] ?? [], payload.tabs!)) return prev
        return { ...prev, [serverId]: payload.tabs! }
      })
      setActiveResultTabsMap(prev => {
        const current = prev[serverId]
        return {
          ...prev,
          [serverId]: current && payload.tabs!.includes(current) ? current : payload.tabs![0]
        }
      })
    }

    if (Array.isArray(payload.files)) {
      setFileSearchStateMap(prev => {
        const nextServerState = Object.fromEntries(
          payload.files!.map(file => [
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
        if (areFileSearchStateMapsEqual(prev[serverId] ?? {}, nextServerState)) return prev
        return {
          ...prev,
          [serverId]: nextServerState
        }
      })
      setIsSearchingMap(prev => {
        const nextSearching = payload.status === 'searching' || payload.files!.some(file => file.active)
        if (!!prev[serverId] === nextSearching) return prev
        return { ...prev, [serverId]: nextSearching }
      })
      return
    }

    if (payload.tabId) {
      updateFileSearchState(serverId, payload.tabId, {
        count: payload.total,
        durationMs: payload.durationMs,
        active: !!payload.active,
        status: payload.status,
        message: payload.message,
        truncated: !!payload.truncated
      })
    }
  }

  const peekResultWindow = async (
    serverId: string,
    runId: string,
    tabId: string,
    offset: number,
    limit: number
  ) => {
    if (!runtimeRef.current || !serverId || !runId || !tabId) return
    const scopeKey = makeScopeKey(serverId, tabId)
    setResultWindowMap(prev => ({
      ...prev,
      [scopeKey]: {
        ...(prev[scopeKey] ?? {
          runId,
          tabId,
          offset,
          limit,
          total: getFileSearchState(serverId, tabId).count,
          lines: [],
          status: getFileSearchState(serverId, tabId).status,
          durationMs: getFileSearchState(serverId, tabId).durationMs
        }),
        runId,
        tabId,
        loading: true
      }
    }))

    try {
      const result = await invokeSelf<PeekResult>('peek_search_results', {
        serverId,
        runId,
        tabId,
        offset,
        limit
      })
      const latestRunId = serverRunIdsRef.current[serverId]
      if (latestRunId && latestRunId !== result.runId) return
      const pendingJump = pendingJumpRef.current[scopeKey]
      if (pendingJump?.runId === result.runId) {
        const resultEnd = result.offset + result.lines.length
        if (pendingJump.targetIndex < result.offset || pendingJump.targetIndex >= resultEnd) {
          return
        }
      }
      const parsedLines = result.lines.map(line => toParsedLogLine(scopeKey, result.runId, line))
      setResultWindowMap(prev => {
        const current = prev[scopeKey]
        const nextWindow: ResultWindowState = {
          runId: result.runId,
          tabId: result.tabId,
          offset: result.offset,
          limit,
          total: result.total,
          lines: parsedLines,
          status: result.status,
          message: result.message,
          durationMs: result.durationMs,
          truncated: !!result.truncated,
          loading: false
        }
        if (current
          && current.runId === nextWindow.runId
          && current.tabId === nextWindow.tabId
          && current.offset === nextWindow.offset
          && current.limit === nextWindow.limit
          && current.total === nextWindow.total
          && current.status === nextWindow.status
          && current.message === nextWindow.message
          && current.durationMs === nextWindow.durationMs
          && !!current.truncated === !!nextWindow.truncated
          && current.loading === nextWindow.loading
          && areParsedLogLinesEqual(current.lines, nextWindow.lines)
        ) {
          return prev
        }
        return {
          ...prev,
          [scopeKey]: nextWindow
        }
      })
      updateFileSearchState(serverId, tabId, {
        count: result.total,
        durationMs: result.durationMs,
        status: result.status,
        message: result.message,
        truncated: !!result.truncated,
        active: result.status === 'searching'
      })
    } catch (err: any) {
      if (pendingJumpRef.current[scopeKey]?.runId === runId) {
        delete pendingJumpRef.current[scopeKey]
      }
      setResultWindowMap(prev => ({
        ...prev,
        [scopeKey]: {
          ...(prev[scopeKey] ?? {
            runId,
            tabId,
            offset,
            limit,
            total: 0,
            lines: [],
            status: 'error' as FileSearchStatus,
            durationMs: 0
          }),
          loading: false,
          status: 'error',
          message: err?.message || String(err)
        }
      }))
    }
  }

  const beginJump = (targetIndex: number, align: JumpAlign) => {
    if (!currentScopeKey || totalResultCount <= 0) return
    const runId = getCurrentRunId(activeServerId)
    const containerHeight = consoleContainerRef.current?.clientHeight || 600
    const estimatedRowHeight = wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT
    const visibleCount = Math.max(1, Math.ceil(containerHeight / estimatedRowHeight))
    const peekWindow = getJumpPeekWindow(
      totalResultCount,
      targetIndex,
      align,
      visibleCount,
      VIRTUAL_OVERSCAN_ROWS,
      PEEK_MAX_LIMIT
    )
    pendingJumpRef.current[currentScopeKey] = {
      runId,
      targetIndex,
      align,
      renderStart: peekWindow.renderStart,
      renderEnd: peekWindow.renderEnd
    }
    setJumpEpoch(value => value + 1)
    if (runId && runtimeRef.current) {
      peekRequestSignaturesRef.current[currentScopeKey] = ''
      peekResultWindow(activeServerId, runId, activeTabId, peekWindow.offset, peekWindow.limit)
    }
  }

  const locateFindResult = (_scopeKey: string, result: FindResult) => {
    if (result.lineIndex < 0) return
    beginJump(result.lineIndex, 'center')
  }

  const updateStoredScrollTop = (scopeKey: string) => {
    const container = consoleContainerRef.current
    if (!container) return
    const nextScrollTop = container.scrollTop
    scrollTopRef.current = nextScrollTop
    const sess = getOrCreateSessionRef(scopeKey, activeServerId, activeTabId)
    sess.scrollTop = nextScrollTop
  }

  const handleJumpToTop = () => {
    beginJump(0, 'start')
  }

  const handleJumpToBottom = () => {
    if (totalResultCount <= 0) return
    beginJump(totalResultCount - 1, 'end')
  }

  const handleFindNavigate = async (direction: 'next' | 'prev') => {
    if (!activeServerId || !activeTabId || !currentScopeKey || !runtimeRef.current) return
    const keyword = findKeyword.trim()
    const runId = getCurrentRunId(activeServerId)
    if (!keyword || !runId) return

    const currentFind = findResultMap[currentScopeKey]
    const fromLine = currentFind?.keyword === keyword && currentFind.lineIndex >= 0
      ? currentFind.lineIndex
      : (direction === 'next' ? -1 : totalResultCount)
    const fromColumn = currentFind?.keyword === keyword && currentFind.lineIndex >= 0
      ? currentFind.start
      : (direction === 'next' ? -1 : Number.MAX_SAFE_INTEGER)

    setFindLoadingForServer(activeServerId, true)
    try {
      const result = await invokeSelf<FindResult>('find_search_results', {
        serverId: activeServerId,
        runId,
        tabId: activeTabId,
        keyword,
        direction,
        fromLine,
        fromColumn,
        ignoreCase: true
      })
      const latestRunId = serverRunIdsRef.current[activeServerId]
      if (latestRunId && latestRunId !== result.runId) return
      setFindResultMap(prev => ({ ...prev, [currentScopeKey]: result }))
      if (result.total > 0) {
        locateFindResult(currentScopeKey, result)
      }
    } catch (err: any) {
      showToast(`查找失败: ${err?.message || String(err)}`)
    } finally {
      setFindLoadingForServer(activeServerId, false)
    }
  }

  const schedulePeekCurrentWindow = () => {
    if (!activeServerId || !activeTabId || !runtimeRef.current) return
    const runId = getCurrentRunId(activeServerId)
    if (!runId) return
    const scopeKey = makeScopeKey(activeServerId, activeTabId)
    if (pendingJumpRef.current[scopeKey]?.runId === runId) return
    const state = getFileSearchState(activeServerId, activeTabId)
    if (state.count <= 0 && !state.active) return

    const estimatedRowHeight = wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT
    const range = visibleRangeRef.current
    const hasRange = range.endIndex >= range.startIndex && (range.endIndex > 0 || range.startIndex > 0)
    let startIndex = 0
    let limit = 50

    if (hasRange) {
      const visibleCount = Math.max(range.endIndex - range.startIndex + 1, 1)
      const prefetchCount = Math.max(visibleCount, VIRTUAL_OVERSCAN_ROWS)
      startIndex = Math.max(0, range.startIndex - prefetchCount)
      limit = Math.min(PEEK_MAX_LIMIT, Math.max(visibleCount + prefetchCount * 2, 50))
    } else {
      const containerHeight = consoleContainerRef.current?.clientHeight || 600
      const visibleCount = Math.ceil(containerHeight / estimatedRowHeight)
      startIndex = Math.max(0, Math.floor(scrollTopRef.current / estimatedRowHeight) - visibleCount)
      limit = Math.min(PEEK_MAX_LIMIT, Math.max(visibleCount * 3, 50))
    }

    if (state.count > 0) {
      limit = Math.min(limit, Math.max(state.count - startIndex, 0))
    }
    if (limit <= 0) return

    const requestSignature = makePeekSignature(runId, activeTabId, startIndex, limit, state.count)

    if (peekRequestSignaturesRef.current[scopeKey] === requestSignature) {
      return
    }

    if (peekTimersRef.current[scopeKey]) {
      window.clearTimeout(peekTimersRef.current[scopeKey])
    }
    peekTimersRef.current[scopeKey] = window.setTimeout(() => {
      peekRequestSignaturesRef.current[scopeKey] = requestSignature
      peekResultWindow(activeServerId, runId, activeTabId, startIndex, limit)
    }, PEEK_DEBOUNCE_MS)
  }

  // 1. owned 实例必须先 start() 钉住进程，再调命令；直接 invoke 会随 Call 结束被关掉
  useEffect(() => {
    let cancelled = false
    let started: BricklyStartedHandle | null = null
    void (async () => {
      if (!window.brickly?.start) {
        showStatus('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用。', 'error')
        return
      }
      try {
        started = await window.brickly.start()
        if (cancelled) {
          await started.dispose()
          return
        }
        runtimeRef.current = started
        await loadAppConfig()
      } catch (err: any) {
        if (!cancelled) {
          showStatus(`Runtime 启动失败: ${err?.message || err}`, 'error')
        }
      }
    })()
    return () => {
      cancelled = true
      runtimeRef.current = null
      if (started) void started.dispose()
    }
  }, [])

  // 2. 切换服务器时还原其对应的滚动位置
  useEffect(() => {
    if (!currentScopeKey) return
    const sess = getOrCreateSessionRef(currentScopeKey)
    scrollTopRef.current = sess.scrollTop
    virtuosoRef.current?.scrollTo({ top: sess.scrollTop })
  }, [currentScopeKey])

  // Ctrl+F 查找高亮快捷键（只作用于当前服务器页面）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeServerId) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowFindBarForServer(activeServerId, true)
        setTimeout(() => findInputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape' && showFindBar) {
        clearFindStateForServer(activeServerId, currentScopeKey)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeServerId, currentScopeKey, showFindBar])

  // Ctrl+F 查找正则（避免逐行重复编译）
  const findRe = React.useMemo(() => {
    if (!findKeyword) return null
    try {
      return new RegExp(escapeRegExp(findKeyword), 'gi')
    } catch {
      return null
    }
  }, [findKeyword])

  const findMatchCount = React.useMemo(() => {
    if (!activeServerId || !findRe) return 0
    return getCurrentLogs().reduce((count, log) => count + countFindMatches(log.content, findRe), 0)
  }, [activeServerId, currentScopeKey, findRe, resultWindowMap])

  useEffect(() => {
    if (!currentScopeKey) return
    setFindResultMap(prev => {
      if (!prev[currentScopeKey]) return prev
      return { ...prev, [currentScopeKey]: null }
    })
  }, [findKeyword, currentScopeKey])

  const statusHighlightRules = React.useMemo(() => {
    return buildStatusHighlightRules(highlightKeywords)
  }, [highlightKeywords])

  // 滚动处理
  const handleRangeChanged = (startIndex: number, endIndex: number) => {
    visibleRangeRef.current = { startIndex, endIndex }
    if (currentScopeKey) {
      const nextScrollTop = consoleContainerRef.current?.scrollTop ?? scrollTopRef.current
      scrollTopRef.current = nextScrollTop
      getOrCreateSessionRef(currentScopeKey).scrollTop = nextScrollTop
    }
    if (scrollPeekFrameRef.current !== null) return
    scrollPeekFrameRef.current = window.requestAnimationFrame(() => {
      scrollPeekFrameRef.current = null
      schedulePeekCurrentWindow()
    })
  }

  const handleScrollerRef = (element: HTMLElement | Window | null) => {
    consoleContainerRef.current = element instanceof HTMLElement ? element : null
  }

  // 加载配置
  const loadAppConfig = async () => {
    if (!runtimeRef.current) {
      showStatus('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用。', 'error')
      return
    }
    try {
      const res = await invokeSelf<{ config?: { servers?: ServerConfig[] } }>('load_config', {})
      const loadedServers = res?.config?.servers || []
      setServers(loadedServers)
      if (loadedServers.length > 0) {
        setActiveServerId(loadedServers[0].id)
      }
      showStatus('配置加载成功', 'active')
    } catch (err: any) {
      showStatus(`配置加载失败: ${err.message || err}`, 'error')
    }
  }

  // 保存配置
  const saveAppConfig = async (nextServers: ServerConfig[]) => {
    if (!runtimeRef.current) return
    try {
      await invokeSelf('save_config', {
        config: { servers: nextServers }
      })
      setServers(nextServers)
      showStatus('配置保存成功', 'active')
    } catch (err: any) {
      showStatus(`配置保存失败: ${err.message || err}`, 'error')
    }
  }

  // 更新辅助状态栏
  const showStatus = (msg: string, dot: 'active' | 'warn' | 'error' | '' = '') => {
    setStatusMessage(msg)
    setStatusDot(dot)
  }

  const cloneServerForEditing = (srv: ServerConfig): ServerConfig => ({
    ...srv,
    logs: srv.logs.map(l => ({ ...l }))
  })

  const closeConfigPanel = () => {
    setConfigPanelOpen(false)
    setEditingServer(null)
    setConnectionTest({ status: 'idle', message: '' })
  }

  const syncConfigPanelToServer = (srv: ServerConfig | null) => {
    if (srv) {
      setEditingServer(cloneServerForEditing(srv))
    } else {
      closeConfigPanel()
      return
    }
    setConnectionTest({ status: 'idle', message: '' })
  }

  useEffect(() => {
    if (!configPanelOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeConfigPanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [configPanelOpen])

  const handleSelectServer = (srv: ServerConfig) => {
    setActiveServerId(srv.id)
    if (configPanelOpen) {
      syncConfigPanelToServer(srv)
    }
  }

  // 新增服务器
  const handleAddNewServer = () => {
    const newServer: ServerConfig = {
      id: 'srv_' + Date.now(),
      name: '未命名服务器',
      host: '',
      port: 22,
      user: 'root',
      authType: 'password',
      password: '',
      keyPath: '',
      keyText: '',
      logs: [{ path: '', enabled: true }]
    }
    setEditingServer(newServer)
    setConnectionTest({ status: 'idle', message: '' })
    setConfigPanelOpen(true)
  }

  // 编辑服务器
  const handleEditServer = (srv: ServerConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    syncConfigPanelToServer(srv)
    setConfigPanelOpen(true)
  }

  // 停止指定服务器的搜索
  const handleStopSearchForServer = (serverId: string, showUserStatus = true) => {
    if (!serverId) return
    serverBatchRunIdsRef.current[serverId] = (serverBatchRunIdsRef.current[serverId] ?? 0) + 1
    clearPeekTrackingForServer(serverId)

    const cancelledHandles = new Set<{ cancel(): void }>()
    for (const sess of Object.values(sessionsRef.current)) {
      if (sess.serverId !== serverId) continue
      sess.active = false
      sess.runId++
      if (sess.streamHandle && !cancelledHandles.has(sess.streamHandle)) {
        cancelledHandles.add(sess.streamHandle)
        sess.streamHandle.cancel()
      }
      finalizeSearchSession(sess.scopeKey, { type: 'cancelled' })
    }

    setIsSearchingMap(prev => ({ ...prev, [serverId]: false }))
    setFileSearchStateMap(prev => ({
      ...prev,
      [serverId]: Object.fromEntries(
        Object.entries(prev[serverId] ?? {}).map(([tabId, state]) => [
          tabId,
          { ...state, active: false, status: 'cancelled' as FileSearchStatus }
        ])
      )
    }))

    if (showUserStatus && activeServerId === serverId) {
      showStatus('查询已由用户中止', 'warn')
    }
  }

  // 删除服务器
  const handleDeleteServer = (srvId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定要删除该服务器配置吗？')) return
    
    handleStopSearchForServer(srvId)
    void invokeSelf('clear_search_results', { serverId: srvId }).catch(() => {})
    clearPeekTrackingForServer(srvId)
    for (const scopeKey of Object.keys(sessionsRef.current)) {
      if (sessionsRef.current[scopeKey].serverId === srvId) {
        delete sessionsRef.current[scopeKey]
      }
    }

    // 清理该服务器页面的独立 UI 状态，避免残留 map 条目
    const dropServerKey = <T,>(prev: Record<string, T>): Record<string, T> => {
      if (!(srvId in prev)) return prev
      const { [srvId]: _, ...rest } = prev
      return rest
    }
    setFindKeywordMap(dropServerKey)
    setShowFindBarMap(dropServerKey)
    setFindLoadingMap(dropServerKey)
    setSearchPatterns(dropServerKey)
    setExtraFiltersMap(dropServerKey)
    setGrepArgsMap(dropServerKey)
    setFindResultMap(prev => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([scopeKey]) => !isServerScopeKey(scopeKey, srvId))
      )
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })

    const next = servers.filter(s => s.id !== srvId)
    saveAppConfig(next)
    if (activeServerId === srvId) {
      const nextActiveServer = next[0] ?? null
      setActiveServerId(nextActiveServer?.id || '')
      if (configPanelOpen) {
        syncConfigPanelToServer(nextActiveServer)
      }
    } else if (editingServer?.id === srvId) {
      syncConfigPanelToServer(null)
    }
  }

  // 克隆服务器配置
  const handleCloneServer = (srv: ServerConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    const cloned: ServerConfig = {
      ...srv,
      id: 'srv_' + Date.now(),
      name: `${srv.name} (副本)`,
      logs: srv.logs.map(l => ({ ...l }))
    }
    const next = [...servers, cloned]
    saveAppConfig(next)
    setActiveServerId(cloned.id)
    if (configPanelOpen) {
      syncConfigPanelToServer(cloned)
    }
  }

  const handleBrowseRemotePath = async (path: string): Promise<RemoteBrowseResult> => {
    if (!runtimeRef.current) {
      throw new Error('Runtime 尚未就绪，请稍后重试')
    }
    if (!editingServer) {
      throw new Error('请先填写服务器连接信息')
    }
    if (!editingServer.host.trim() || !editingServer.user.trim()) {
      throw new Error('请先填写主机和用户名，再浏览远程目录')
    }
    return invokeSelf<RemoteBrowseResult>('browse_remote_path', {
      server: editingServer,
      path
    })
  }

  const handleTestConnection = async () => {
    if (!editingServer) return
    if (!runtimeRef.current) {
      setConnectionTest({ status: 'error', message: '底座 API 未注入，无法测试连接。' })
      return
    }

    setConnectionTest({ status: 'testing', message: '正在测试连接...' })
    try {
      const serverToTest: ServerConfig = {
        ...editingServer,
        logs: editingServer.logs
          .filter(log => log.path.trim() !== '')
          .map(log => ({ ...log, path: log.path.trim() }))
      }
      const res = await invokeSelf<{ ok?: boolean; message?: string }>('test_connection', { server: serverToTest })
      setConnectionTest({
        status: res?.ok ? 'success' : 'error',
        message: res?.message || (res?.ok ? '连接可用。' : '连接测试失败。')
      })
      showStatus(res?.message || '连接测试完成', res?.ok ? 'active' : 'error')
    } catch (err: any) {
      const rawMessage = err?.message || String(err)
      const message = normalizeConnectionTestError(rawMessage)
      setConnectionTest({ status: 'error', message })
      showStatus(`连接测试失败: ${message}`, 'error')
    }
  }

  const normalizeConnectionTestError = (message: string): string => {
    if (message.includes('test_connection') && message.includes('not found')) {
      return '当前运行实例还没加载“测试连接”能力。请重新加载或重启这个日志查询工具后再试。'
    }
    if (message.includes('BridgeError')) {
      return message.replace(/^.*BridgeError:\s*/s, '').trim() || '宿主调用失败，请重新加载工具后再试。'
    }
    return message
  }

  // 保存表单
  const handleSaveForm = () => {
    if (!editingServer) return
    if (!editingServer.name.trim()) {
      alert('请输入服务器名称')
      return
    }

    // 过滤掉空的路径并对路径去除首尾空格
    const cleanedLogs = editingServer.logs
      .filter(l => l.path.trim() !== '')
      .map(l => ({ ...l, path: l.path.trim() }))
    const serverToSave = { ...editingServer, logs: cleanedLogs }

    let nextServers: ServerConfig[] = []
    const exists = servers.some(s => s.id === serverToSave.id)
    if (exists) {
      nextServers = servers.map(s => (s.id === serverToSave.id ? serverToSave : s))
    } else {
      nextServers = [...servers, serverToSave]
    }

    saveAppConfig(nextServers)
    closeConfigPanel()
    if (!activeServerId) {
      setActiveServerId(serverToSave.id)
    }
  }

  // 表单操作：添加日志文件路径
  const handleAddLogPath = () => {
    if (!editingServer) return
    setEditingServer({
      ...editingServer,
      logs: [...editingServer.logs, { path: '', enabled: true }]
    })
  }

  // 表单操作：更新日志文件路径
  const handleUpdateLogPath = (index: number, fields: Partial<LogFileConfig>) => {
    if (!editingServer) return
    const nextLogs = editingServer.logs.map((l, i) => (i === index ? { ...l, ...fields } : l))
    setEditingServer({ ...editingServer, logs: nextLogs })
  }

  // 表单操作：移除日志文件路径
  const handleRemoveLogPath = (index: number) => {
    if (!editingServer) return
    const nextLogs = editingServer.logs.filter((_, i) => i !== index)
    setEditingServer({
      ...editingServer,
      logs: nextLogs.length > 0 ? nextLogs : [{ path: '', enabled: true }]
    })
  }

  const resetSearchSession = (scopeKey: string, serverId: string, tabId: string): SessionControl => {
    const sess = getOrCreateSessionRef(scopeKey, serverId, tabId)
    if (sess.streamHandle) {
      sess.streamHandle.cancel()
    }
    sess.searchStartTime = Date.now()
    sess.active = false
    sess.streamHandle = null
    sess.scrollTop = 0
    sess.runId++
    return sess
  }

  // -------------------- 执行搜索 --------------------
  const handleSearch = () => {
    if (!activeServerId) {
      showToast('请先添加并选择服务器配置')
      return
    }
    const targetServerId = activeServerId
    const targetServer = findServer(targetServerId)
    const currentPattern = getSearchPattern(targetServerId)
    const currentGrepArgs = getGrepArgs(targetServerId)

    if (getIsSearching(targetServerId)) return
    if (!currentPattern.trim()) {
      showToast('请输入查询关键词或正则表达式')
      return
    }
    if (!runtimeRef.current) {
      showStatus('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用。', 'error')
      return
    }
    if (!targetServer) {
      showStatus('当前服务器配置不存在，请重新选择连接。', 'error')
      return
    }

    handleStopSearchForServer(targetServerId, false)
    clearPeekTrackingForServer(targetServerId)

    const effectiveExtraFilters = getExtraFilters(targetServerId).filter(filter => filter.pattern.trim() !== '')
    const searchArgs: GrepArgs = {
      ...currentGrepArgs,
      maxCount: 0,
      fromTail: false,
      tailBytes: currentGrepArgs.tailBytes ?? DEFAULT_GREP_ARGS.tailBytes,
      showLineNum: false,
      showFilename: false,
      filters: effectiveExtraFilters
    }

    const selectedFiles = selectedFilesMap[targetServerId] || []
    const availableFiles = availableFilesMap[targetServerId] || []
    const availableFilePaths = availableFiles.map(file => file.path)
    if (availableFiles.length === 0) {
      const fileListStatus = fileListStatusMap[targetServerId] ?? 'idle'
      if (fileListStatus === 'loading' || fileListStatus === 'idle') {
        showToast('日志文件仍在加载，请稍后再试')
      } else {
        showToast('日志文件列表不可用，请刷新后再试')
      }
      return
    }
    const filesToSearch = selectedFiles.length > 0
      ? selectedFiles.filter(file => availableFilePaths.includes(file))
      : availableFilePaths.slice(0, 5)
    if (filesToSearch.length === 0) {
      showToast('请先选择至少一个日志文件')
      return
    }
    const fileTabs = filesToSearch
    const batchRunId = (serverBatchRunIdsRef.current[targetServerId] ?? 0) + 1
    serverBatchRunIdsRef.current[targetServerId] = batchRunId

    const activeScopeKeys = new Set(fileTabs.map(tabId => makeScopeKey(targetServerId, tabId)))
    for (const [scopeKey, sess] of Object.entries(sessionsRef.current)) {
      if (sess.serverId !== targetServerId || activeScopeKeys.has(scopeKey)) continue
      if (sess.streamHandle) sess.streamHandle.cancel()
      delete sessionsRef.current[scopeKey]
    }
    for (const tabId of fileTabs) {
      resetSearchSession(makeScopeKey(targetServerId, tabId), targetServerId, tabId)
    }

    setServerRunIdsMap(prev => ({ ...prev, [targetServerId]: '' }))
    setResultTabsMap(prev => ({ ...prev, [targetServerId]: fileTabs }))
    setActiveResultTabsMap(prev => ({ ...prev, [targetServerId]: fileTabs[0] }))
    setResultWindowMap(prev => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([scopeKey]) => (
          !isServerScopeKey(scopeKey, targetServerId) || activeScopeKeys.has(scopeKey)
        ))
      )
      for (const tabId of fileTabs) {
        next[makeScopeKey(targetServerId, tabId)] = {
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
      return next
    })
    setFileSearchStateMap(prev => ({
      ...prev,
      [targetServerId]: Object.fromEntries(
        fileTabs.map(tabId => [
          tabId,
          {
            count: 0,
            durationMs: 0,
            active: false,
            status: 'queued' as FileSearchStatus
          }
        ])
      )
    }))
    setIsSearchingMap(prev => ({ ...prev, [targetServerId]: true }))
    setCommittedPatterns(prev => ({ ...prev, [targetServerId]: currentPattern }))
    setCommittedGrepArgs(prev => ({ ...prev, [targetServerId]: { ...searchArgs } }))

    if (activeServerId === targetServerId) {
      showStatus(`正在检索 ${fileTabs.length} 个日志视图...`, 'warn')
    }

    const runtime = runtimeRef.current
    if (!runtime) {
      showStatus('Runtime 尚未就绪，请稍后重试。', 'error')
      return
    }
    const abort = new AbortController()
    const handle = {
      cancel() {
        abort.abort()
      }
    }

    for (const tabId of fileTabs) {
      const sess = getOrCreateSessionRef(makeScopeKey(targetServerId, tabId), targetServerId, tabId)
      sess.streamHandle = handle
      sess.active = true
    }

    void (async () => {
      try {
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) {
          abort.abort()
          return
        }

        const result = await runtime.call('search', {
          serverId: targetServerId,
          pattern: currentPattern,
          args: searchArgs,
          files: filesToSearch,
          resultMode: 'store'
        }, {
          signal: abort.signal,
          onEvent(raw) {
            if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) return
            const event = raw as BricklySearchEvent
            if (event?.type === 'progress' && activeServerId === targetServerId) {
              showStatus(event.message || `正在检索 ${fileTabs.length} 个日志视图...`, 'warn')
            }
            if (event?.type === 'searchState' && event.searchState) {
              updateStateFromSearchPayload(event.searchState)
            }
          }
        }) as { runId?: string } | undefined
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) return
        if (result?.runId) {
          setServerRunIdsMap(prev => ({ ...prev, [targetServerId]: String(result.runId) }))
        }
      } catch (err: any) {
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) return
        const message = err?.message || String(err)
        if (/CANCELLED/i.test(message)) return
        setIsSearchingMap(prev => ({ ...prev, [targetServerId]: false }))
        setFileSearchStateMap(prev => ({
          ...prev,
          [targetServerId]: Object.fromEntries(
            Object.entries(prev[targetServerId] ?? {}).map(([tabId, state]) => [
              tabId,
              { ...state, active: false, status: 'error' as FileSearchStatus, message: message || '未知错误' }
            ])
          )
        }))
        showStatus(`检索出错: ${message || '未知错误'}`, 'error')
      } finally {
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) return
        setIsSearchingMap(prev => ({ ...prev, [targetServerId]: false }))
        const states = getFileSearchStates(targetServerId)
        const totalCount = Object.values(states).reduce((sum, state) => sum + state.count, 0)
        const errorCount = Object.values(states).filter(state => state.status === 'error').length
        if (activeServerId === targetServerId) {
          if (errorCount > 0) {
            showStatus(`查询完成但 ${errorCount} 个文件出错，已输出 ${totalCount} 行`, 'error')
          } else {
            showStatus(`查询完成，匹配 ${totalCount} 行`, 'active')
          }
        }
      }
    })()
  }

  // 停止当前服务器搜索
  const handleStopSearch = () => {
    handleStopSearchForServer(activeServerId)
  }

  // 复制结果
  const handleCopyLogs = () => {
    const currentLogs = getCurrentLogs()
    if (currentLogs.length === 0) return
    const text = currentLogs.map(l => l.content).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制当前视图日志结果')
    })
  }

  const activeServer = servers.find(s => s.id === activeServerId)
  const resultTabs = getResultTabs(activeServerId)
  const fileStates = getFileSearchStates(activeServerId)
  const visibleResultTabs = activeServerId ? getVisibleResultTabs(activeServerId) : []
  const emptyCompletedTabCount = activeServerId
    ? resultTabs.filter(tabId => isEmptyCompletedResultTab(fileStates[tabId])).length
    : 0
  const currentLogs = getCurrentLogs()
  const currentStats = getCurrentStats()
  const activeFileState = getFileSearchState(activeServerId, activeTabId)
  const activeResultWindow = currentScopeKey ? getResultWindow(currentScopeKey) : undefined
  const totalResultCount = Math.max(activeResultWindow?.total ?? 0, activeFileState.count)
  const activeResultCountKey = `${getCurrentRunId(activeServerId)}:${activeFileState.count}`
  const visibleLogByIndex = React.useMemo(() => {
    return new Map(currentLogs.map(log => [log.index, log]))
  }, [currentLogs])
  const listKey = `${getCurrentRunId(activeServerId)}:${activeTabId}:${wrapLines ? 'wrap' : 'single'}`

  useEffect(() => {
    return () => {
      if (scrollPeekFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollPeekFrameRef.current)
        scrollPeekFrameRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!currentScopeKey || !activeResultWindow) return
    const pending = pendingJumpRef.current[currentScopeKey]
    if (!pending) return
    if (pending.runId && pending.runId !== activeResultWindow.runId) return
    if (activeResultWindow.loading || activeResultWindow.lines.length === 0) return
    if (!currentLogs.some(log => log.index === pending.targetIndex)) return

    virtuosoRef.current?.scrollToIndex({
      index: pending.targetIndex,
      align: pending.align,
      behavior: 'auto'
    })
    updateStoredScrollTop(currentScopeKey)
    delete pendingJumpRef.current[currentScopeKey]
  }, [
    currentScopeKey,
    jumpEpoch,
    currentLogs,
    activeResultWindow?.runId,
    activeResultWindow?.offset,
    activeResultWindow?.loading
  ])

  // 当前视图只按虚拟列表可见窗口从 Go 侧拉取结果，避免 renderer 持有全量日志。
  useEffect(() => {
    if (!currentScopeKey) return
    schedulePeekCurrentWindow()
  }, [
    activeServerId,
    activeTabId,
    currentScopeKey,
    serverRunIdsMap,
    activeResultCountKey
  ])

  return (
    <div className="app-root">
      <TitleBar />
      <main className={`app-shell ${sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''}`}>
        <ServerSidebar
          servers={servers}
          activeServerId={activeServerId}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleSidebarCollapsed}
          onAdd={handleAddNewServer}
          onSelect={handleSelectServer}
          onEdit={handleEditServer}
          onClone={handleCloneServer}
          onDelete={handleDeleteServer}
        />

        <section className="main-content">
          <SearchToolbar
            serverId={activeServerId}
            searchPattern={getSearchPattern(activeServerId)}
            isSearching={getIsSearching(activeServerId)}
            toastMessage={toastMessage}
            grepArgs={getGrepArgs(activeServerId)}
            extraFilters={getExtraFilters(activeServerId)}
            highlightPanelOpen={highlightPanelOpen}
            highlightKeywords={highlightKeywords}
            availableFiles={availableFilesMap[activeServerId] || []}
            selectedFiles={selectedFilesMap[activeServerId] || []}
            fileListStatus={fileListStatusMap[activeServerId] ?? 'idle'}
            dateFilter={getDateFilter(activeServerId)}
            dateMatchedPaths={
              isDateFilterActive(getDateFilter(activeServerId))
                ? filterFilesByModifiedDate(
                  availableFilesMap[activeServerId] || [],
                  getDateFilter(activeServerId)
                ).map(file => file.path)
                : []
            }
            canEditConnection={!!activeServerId}
            onSearchPatternChange={(value) => setSearchPatterns({ ...searchPatterns, [activeServerId]: value })}
            onSearch={handleSearch}
            onStop={handleStopSearch}
            onToggleConfig={() => {
              if (configPanelOpen && editingServer?.id === activeServerId) {
                closeConfigPanel()
                return
              }
              const srv = servers.find(s => s.id === activeServerId)
              if (srv) {
                syncConfigPanelToServer(srv)
                setConfigPanelOpen(true)
              }
            }}
            onUpdateGrepArgs={(fields) => updateGrepArgs(activeServerId, fields)}
            onAddFilter={() => handleAddExtraFilter(activeServerId)}
            onUpdateFilter={(index, fields) => handleUpdateExtraFilter(activeServerId, index, fields)}
            onRemoveFilter={(index) => handleRemoveExtraFilter(activeServerId, index)}
            onToggleHighlight={handleToggleHighlightPanel}
            onResetHighlight={resetHighlightKeywords}
            onUpdateHighlight={updateHighlightKeywords}
            onRefreshFiles={() => fetchAvailableFiles(activeServerId)}
            onChangeSelectedFiles={(paths) => setSelectedFilesMap(prev => ({ ...prev, [activeServerId]: paths }))}
            onDateFilterChange={handleDateFilterChange}
            onDateFilterPreset={handleDateFilterPreset}
            onClearDateFilter={handleClearDateFilter}
          />

          <section className="workspace">
            <ResultsPane
              activeServer={activeServer}
              activeServerId={activeServerId}
              activeTabId={activeTabId}
              visibleResultTabs={visibleResultTabs}
              emptyCompletedTabCount={emptyCompletedTabCount}
              availableFiles={availableFilesMap[activeServerId] || []}
              fileStates={getFileSearchStates(activeServerId)}
              currentLogs={currentLogs}
              currentStats={currentStats}
              activeFileState={activeFileState}
              totalResultCount={totalResultCount}
              wrapLines={wrapLines}
              showFindBar={showFindBar}
              findKeyword={findKeyword}
              findLoading={findLoading}
              findMatchCount={findMatchCount}
              findResult={currentScopeKey ? findResultMap[currentScopeKey] ?? null : null}
              findInputRef={findInputRef}
              listKey={listKey}
              logsByIndex={visibleLogByIndex}
              defaultRowHeight={wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT}
              virtuosoRef={virtuosoRef}
              committedPattern={committedPatterns[activeServerId]}
              committedArgs={committedGrepArgs[activeServerId]}
              findRe={findRe}
              statusHighlightRules={statusHighlightRules}
              onSelectTab={(tabId) => setActiveResultTabsMap(prev => ({ ...prev, [activeServerId]: tabId }))}
              onToggleWrap={handleToggleWrapLines}
              onCopy={handleCopyLogs}
              onFindKeywordChange={(value) => setFindKeywordForServer(activeServerId, value)}
              onFindNavigate={handleFindNavigate}
              onCloseFind={() => clearFindStateForServer(activeServerId, currentScopeKey)}
              onRangeChanged={handleRangeChanged}
              onScrollerRef={handleScrollerRef}
              onJumpTop={handleJumpToTop}
              onJumpBottom={handleJumpToBottom}
            />
          </section>

          <StatusBar message={statusMessage} dot={statusDot} />
        </section>
      </main>

      {configPanelOpen && editingServer && (
        <ConfigModal
          server={editingServer}
          isExisting={servers.some(s => s.id === editingServer.id)}
          connectionTest={connectionTest}
          onClose={closeConfigPanel}
          onChange={setEditingServer}
          onAddLogPath={handleAddLogPath}
          onUpdateLogPath={handleUpdateLogPath}
          onRemoveLogPath={handleRemoveLogPath}
          onBrowseRemote={handleBrowseRemotePath}
          onTest={handleTestConnection}
          onSave={handleSaveForm}
        />
      )}
    </div>
  )
}
