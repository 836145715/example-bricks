import React, { useState, useEffect, useRef } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import {
  Server,
  Plus,
  Settings,
  Trash2,
  Search,
  XCircle,
  X,
  Folder,
  Copy,
  Play,
  Check,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  PlugZap,
  TextWrap,
  ChevronUp,
  ChevronDown
} from 'lucide-react'
import {
  DEFAULT_STATUS_HIGHLIGHT_KEYWORDS,
  HIGHLIGHT_WORD_SEPARATOR,
  HighlightKeywordTextMap,
  StatusHighlightKind,
  buildStatusHighlightRules,
  countFindMatches,
  escapeRegExp,
  mergeHighlightRanges
} from './domain/highlight'
import { getDefaultSelectedFiles, getLogFileName, sortLogFiles } from './domain/logFiles'

// --- 声明 window 上的全局 brickly 属性类型 ---
declare global {
  interface Window {
    brickly?: {
      brickId: string
      invoke(commandId: string, input: Record<string, any>): Promise<any>
      stream(
        commandId: string,
        input: Record<string, any>,
        callbacks: {
          onProgress?: (progress: number, message?: string) => void
          onChunk?: (name: string | undefined, chunk: any) => void
          onOutput?: (name: string, value: any) => void
          onResult?: (result: any) => void
          onError?: (error: { code: string; message: string; details?: any }) => void
          onDone?: () => void
        }
      ): { cancel(): void }
      system: any
    }
  }
}

interface LogFileConfig {
  path: string
  enabled: boolean
}

interface ServerConfig {
  id: string
  name: string
  type: 'local' | 'ssh'
  host: string
  port: number
  user: string
  authType: 'password' | 'key'
  password?: string
  keyPath?: string
  keyText?: string
  logs: LogFileConfig[]
}

interface GrepArgs {
  ignoreCase: boolean
  invert: boolean
  wordRegexp: boolean
  regexp: boolean
  contextA: number
  contextB: number
  contextC: number
  onlyMatch: boolean
  maxCount: number // 每文件保留最新 N 条命中，0 表示不限
  showLineNum: boolean // 兼容旧调用，UI 固定关闭
  showFilename: boolean // 兼容旧调用，UI 固定关闭
  fromTail: boolean // 仅搜索文件尾部窗口
  tailLines: number // 文件尾部窗口行数
  filters?: FilterConfig[]
}

interface FilterConfig {
  pattern: string
  regexp: boolean
  ignoreCase: boolean
  invert: boolean
  wordRegexp: boolean
}

interface ParsedLogLine {
  id: string
  index: number
  file: string
  content: string
  isContext: boolean
  error?: string
  matches?: Array<[number, number]>
}

const FALLBACK_RESULTS_SCOPE = '__fallback__'

type FileSearchStatus = 'idle' | 'queued' | 'searching' | 'success' | 'error' | 'cancelled' | 'done'

interface FileSearchState {
  count: number
  durationMs: number
  active: boolean
  status: FileSearchStatus
  message?: string
  truncated?: boolean
}

interface SearchFileStatePayload {
  tabId: string
  total: number
  status: FileSearchStatus
  message?: string
  durationMs: number
  truncated?: boolean
  active?: boolean
}

interface SearchStatePayload {
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

interface PeekResult {
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

interface FindResult {
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

interface ResultWindowState {
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

  // Ctrl+F 查找高亮
  const [findKeyword, setFindKeyword] = useState('')
  const [showFindBar, setShowFindBar] = useState(false)
  const [findResultMap, setFindResultMap] = useState<Record<string, FindResult | null>>({})
  const [findLoading, setFindLoading] = useState(false)
  const findInputRef = useRef<HTMLInputElement | null>(null)

  const [statusMessage, setStatusMessage] = useState<string>('就绪')
  const [statusDot, setStatusDot] = useState<'active' | 'warn' | 'error' | ''>('active')
  const [toastMessage, setToastMessage] = useState<string>('')

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(''), 2500)
  }

  // 虚拟滚动状态与 Ref
  const consoleContainerRef = useRef<HTMLDivElement | null>(null)
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
  const [availableFilesMap, setAvailableFilesMap] = useState<Record<string, string[]>>({})
  const [selectedFilesMap, setSelectedFilesMap] = useState<Record<string, string[]>>({})
  const [isListLoadingMap, setIsListLoadingMap] = useState<Record<string, boolean>>({})
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false)
  const [fileFilterText, setFileFilterText] = useState<string>('')
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  // 点击外部自动收起下拉框
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  // 刷新拉取当前服务器下的日志文件列表
  const fetchAvailableFiles = async (serverId: string) => {
    if (!window.brickly || !serverId) return
    setIsListLoadingMap(prev => ({ ...prev, [serverId]: true }))
    try {
      const res = await window.brickly.invoke('list_log_files', { serverId })
      const files: string[] = res?.files || []
      const sortedFiles = sortLogFiles(files)
      setAvailableFilesMap(prev => ({ ...prev, [serverId]: sortedFiles }))

      // 默认勾选逻辑：如果是配置里的直接文件且 enabled 的，则默认勾选。若是通配符或路径，默认不勾选。
      const server = servers.find(s => s.id === serverId)
      if (server) {
        setSelectedFilesMap(prev => ({
          ...prev,
          [serverId]: getDefaultSelectedFiles(sortedFiles, server.logs)
        }))
      }
    } catch (err: any) {
      console.error('fetch log files err:', err)
      setAvailableFilesMap(prev => ({ ...prev, [serverId]: [] }))
    } finally {
      setIsListLoadingMap(prev => ({ ...prev, [serverId]: false }))
    }
  }

  // 每次活动服务器或配置改变，重新异步获取日志文件
  useEffect(() => {
    if (activeServerId && servers.length > 0) {
      fetchAvailableFiles(activeServerId)
    }
  }, [activeServerId, servers])

  // 各服务器检索配置安全读取 Getter & Setter
  const getSearchPattern = (id: string): string => {
    return searchPatterns[id] ?? ''
  }

  const defaultGrepArgs: GrepArgs = {
    ignoreCase: true,
    invert: false,
    wordRegexp: false,
    regexp: false,
    contextA: 0,
    contextB: 0,
    contextC: 0,
    onlyMatch: false,
    maxCount: 500,
    showLineNum: false,
    showFilename: false,
    fromTail: false,
    tailLines: 1000
  }

  const getGrepArgs = (id: string): GrepArgs => {
    return grepArgsMap[id] ?? defaultGrepArgs
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

  const getActiveResultTab = (serverId: string): string => {
    const tabs = resultTabsMap[serverId] ?? []
    const activeTab = activeResultTabsMap[serverId]
    if (activeTab && tabs.includes(activeTab)) return activeTab
    return tabs[0] ?? FALLBACK_RESULTS_SCOPE
  }

  const getActiveScopeKey = (serverId: string): string => {
    return makeScopeKey(serverId, getActiveResultTab(serverId))
  }

  const activeTabId = getActiveResultTab(activeServerId)
  const currentScopeKey = activeServerId ? makeScopeKey(activeServerId, activeTabId) : ''

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
    align: 'start' | 'end'
    renderStart: number
    renderEnd: number
  }>>({})

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
    if (!window.brickly || !serverId || !runId || !tabId) return
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
      const result: PeekResult = await window.brickly.invoke('peek_search_results', {
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

  const locateFindResult = (scopeKey: string, result: FindResult) => {
    if (result.lineIndex < 0) return
    const prefetchOffset = Math.max(0, result.lineIndex - 25)
    const prefetchLimit = Math.min(PEEK_MAX_LIMIT, 80)
    peekRequestSignaturesRef.current[scopeKey] = ''
    peekResultWindow(activeServerId, result.runId, result.tabId, prefetchOffset, prefetchLimit)
    rowVirtualizer.scrollToIndex(result.lineIndex, { align: 'center' })
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
    if (!currentScopeKey || totalResultCount <= 0) return
    const runId = getCurrentRunId(activeServerId)
    const limit = Math.min(PEEK_MAX_LIMIT, Math.min(Math.max(80, VIRTUAL_OVERSCAN_ROWS * 4), totalResultCount))
    if (!runId) {
      rowVirtualizer.scrollToIndex(0, { align: 'start' })
      window.requestAnimationFrame(() => updateStoredScrollTop(currentScopeKey))
      return
    }
    pendingJumpRef.current[currentScopeKey] = {
      runId,
      targetIndex: 0,
      align: 'start',
      renderStart: 0,
      renderEnd: Math.max(0, limit - 1)
    }
    if (runId && window.brickly) {
      peekRequestSignaturesRef.current[currentScopeKey] = ''
      peekResultWindow(activeServerId, runId, activeTabId, 0, limit)
    }
  }

  const handleJumpToBottom = () => {
    if (!currentScopeKey || totalResultCount <= 0) return
    const runId = getCurrentRunId(activeServerId)
    const targetIndex = totalResultCount - 1
    const limit = Math.min(PEEK_MAX_LIMIT, Math.min(Math.max(80, VIRTUAL_OVERSCAN_ROWS * 4), totalResultCount))
    const offset = Math.max(0, totalResultCount - limit)
    if (!runId) {
      rowVirtualizer.scrollToIndex(targetIndex, { align: 'end' })
      window.requestAnimationFrame(() => updateStoredScrollTop(currentScopeKey))
      return
    }
    pendingJumpRef.current[currentScopeKey] = {
      runId,
      targetIndex,
      align: 'end',
      renderStart: offset,
      renderEnd: targetIndex
    }
    if (runId && window.brickly) {
      peekRequestSignaturesRef.current[currentScopeKey] = ''
      peekResultWindow(activeServerId, runId, activeTabId, offset, limit)
    }
  }

  const handleFindNavigate = async (direction: 'next' | 'prev') => {
    if (!activeServerId || !activeTabId || !currentScopeKey || !window.brickly) return
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

    setFindLoading(true)
    try {
      const result: FindResult = await window.brickly.invoke('find_search_results', {
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
      setFindLoading(false)
    }
  }

  const schedulePeekCurrentWindow = () => {
    if (!activeServerId || !activeTabId || !window.brickly) return
    const runId = getCurrentRunId(activeServerId)
    if (!runId) return
    const scopeKey = makeScopeKey(activeServerId, activeTabId)
    if (pendingJumpRef.current[scopeKey]?.runId === runId) return
    const state = getFileSearchState(activeServerId, activeTabId)
    if (state.count <= 0 && !state.active) return

    const virtualItems = rowVirtualizer.getVirtualItems()
    const estimatedRowHeight = wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT
    let startIndex = 0
    let limit = 50

    if (virtualItems.length > 0) {
      const firstVisibleIndex = virtualItems[0].index
      const lastVisibleIndex = virtualItems[virtualItems.length - 1].index
      const visibleCount = Math.max(lastVisibleIndex - firstVisibleIndex + 1, 1)
      const prefetchCount = Math.max(visibleCount, VIRTUAL_OVERSCAN_ROWS)
      startIndex = Math.max(0, firstVisibleIndex - prefetchCount)
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

  // 1. 初始化时加载配置
  useEffect(() => {
    loadAppConfig()
  }, [])

  // 2. 切换服务器时还原其对应的滚动位置
  useEffect(() => {
    const container = consoleContainerRef.current
    if (container && currentScopeKey) {
      const sess = getOrCreateSessionRef(currentScopeKey)
      container.scrollTop = sess.scrollTop
      scrollTopRef.current = sess.scrollTop
    }
  }, [currentScopeKey])

  // Ctrl+F 查找高亮快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowFindBar(true)
        setTimeout(() => findInputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape' && showFindBar) {
        setShowFindBar(false)
        setFindKeyword('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showFindBar])

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
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!currentScopeKey) return
    const targetScrollTop = e.currentTarget.scrollTop
    scrollTopRef.current = targetScrollTop
    const sess = getOrCreateSessionRef(currentScopeKey)
    sess.scrollTop = targetScrollTop
    if (scrollPeekFrameRef.current !== null) return
    scrollPeekFrameRef.current = window.requestAnimationFrame(() => {
      scrollPeekFrameRef.current = null
      schedulePeekCurrentWindow()
    })
  }

  // 加载配置
  const loadAppConfig = async () => {
    if (!window.brickly) {
      showStatus('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用。', 'error')
      return
    }
    try {
      const res = await window.brickly.invoke('load_config', {})
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
    if (!window.brickly) return
    try {
      await window.brickly.invoke('save_config', {
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

  const syncConfigPanelToServer = (srv: ServerConfig | null) => {
    if (srv) {
      setEditingServer(cloneServerForEditing(srv))
    } else {
      setEditingServer(null)
      setConfigPanelOpen(false)
    }
    setConnectionTest({ status: 'idle', message: '' })
  }

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
      type: 'local',
      host: 'localhost',
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
    window.brickly?.invoke('clear_search_results', { serverId: srvId }).catch(() => {})
    clearPeekTrackingForServer(srvId)
    for (const scopeKey of Object.keys(sessionsRef.current)) {
      if (sessionsRef.current[scopeKey].serverId === srvId) {
        delete sessionsRef.current[scopeKey]
      }
    }

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

  const handleTestConnection = async () => {
    if (!editingServer) return
    if (!window.brickly) {
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
      const res = await window.brickly.invoke('test_connection', { server: serverToTest })
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
    setConfigPanelOpen(false)
    setEditingServer(null)
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
    if (!window.brickly) {
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
      showLineNum: false,
      showFilename: false,
      filters: effectiveExtraFilters
    }

    const selectedFiles = selectedFilesMap[targetServerId] || []
    const filesToSearch = selectedFiles.length > 0
      ? selectedFiles
      : (availableFilesMap[targetServerId] || []).slice(0, 5)
    const fileTabs = filesToSearch.length > 0 ? filesToSearch : [FALLBACK_RESULTS_SCOPE]
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

    const handle = window.brickly.stream('search', {
      serverId: targetServerId,
      pattern: currentPattern,
      args: searchArgs,
      files: filesToSearch,
      resultMode: 'store'
    }, {
      onProgress: (_progress: number, msg?: string) => {
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) return
        if (activeServerId === targetServerId) {
          showStatus(msg || `正在检索 ${fileTabs.length} 个日志视图...`, 'warn')
        }
      },
      onChunk: (name: string | undefined, chunk: any) => {
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId || name !== 'searchState') return
        updateStateFromSearchPayload(chunk as SearchStatePayload)
      },
      onResult: (result: any) => {
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) return
        if (result?.runId) {
          setServerRunIdsMap(prev => ({ ...prev, [targetServerId]: String(result.runId) }))
        }
      },
      onError: (err: { code: string; message: string; details?: any }) => {
        if (serverBatchRunIdsRef.current[targetServerId] !== batchRunId) return
        setIsSearchingMap(prev => ({ ...prev, [targetServerId]: false }))
        setFileSearchStateMap(prev => ({
          ...prev,
          [targetServerId]: Object.fromEntries(
            Object.entries(prev[targetServerId] ?? {}).map(([tabId, state]) => [
              tabId,
              { ...state, active: false, status: 'error' as FileSearchStatus, message: err.message || '未知错误' }
            ])
          )
        }))
        showStatus(`检索出错: ${err.message || '未知错误'}`, 'error')
      },
      onDone: () => {
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
    })

    for (const tabId of fileTabs) {
      const sess = getOrCreateSessionRef(makeScopeKey(targetServerId, tabId), targetServerId, tabId)
      sess.streamHandle = handle
      sess.active = true
    }
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

  const getSearchMatchesFromLegacyLine = (
    log: ParsedLogLine,
    committedPattern: string,
    committedArgs: GrepArgs
  ): Array<[number, number]> => {
    try {
      let rePattern = committedArgs.regexp ? committedPattern : escapeRegExp(committedPattern)
      if (committedArgs.wordRegexp) {
        rePattern = '\\b' + rePattern + '\\b'
      }
      const flags = committedArgs.ignoreCase ? 'gi' : 'g'
      const re = new RegExp(`(${rePattern})`, flags)
      const parts = log.content.split(re)
      let pos = 0
      const matches: Array<[number, number]> = []

      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          matches.push([pos, pos + parts[i].length])
        }
        pos += parts[i].length
      }

      return matches
    } catch {
      return []
    }
  }

  // 高亮渲染：新协议优先使用后端完整区间，旧协议再按主关键词兜底计算
  const renderHighlightedContent = (log: ParsedLogLine) => {
    const committedPattern = committedPatterns[activeServerId]
    const committedArgs = committedGrepArgs[activeServerId]

    // 收集检索匹配区间
    let searchMatches: Array<[number, number]> = []
    if (log.matches !== undefined) {
      searchMatches = log.matches
    } else if (committedPattern && !committedArgs?.invert) {
      searchMatches = getSearchMatchesFromLegacyLine(log, committedPattern, committedArgs)
    }

    const activeFindResult = currentScopeKey ? findResultMap[currentScopeKey] : null
    const activeFindRange = activeFindResult
      && activeFindResult.keyword === findKeyword.trim()
      && activeFindResult.lineIndex === log.index
      && activeFindResult.start < activeFindResult.end
      ? [activeFindResult.start, activeFindResult.end] as [number, number]
      : null
    const segments = mergeHighlightRanges(log.content, searchMatches, findRe, statusHighlightRules, activeFindRange)

    return (
      <span>
        {segments.map((seg, i) =>
          seg.className
            ? <span key={i} className={seg.className}>{seg.text}</span>
            : <span key={i}>{seg.text}</span>
        )}
      </span>
    )
  }

  const getTabLabel = (tabId: string): string => {
    if (tabId === FALLBACK_RESULTS_SCOPE) return '默认路径'
    return getLogFileName(tabId)
  }

  const getTabTitle = (tabId: string): string => {
    if (tabId === FALLBACK_RESULTS_SCOPE) return '服务器配置中的启用日志路径'
    return tabId
  }

  const getFileSearchStatusText = (state: FileSearchState): string => {
    if (state.status === 'queued') return '等待检索'
    if (state.status === 'searching') return '正在检索'
    if (state.status === 'error') return `出错: ${state.message || '未知错误'}`
    if (state.status === 'cancelled') return '已取消'
    if (state.status === 'success' || state.status === 'done') {
      return `已完成，匹配 ${state.count} 行${state.durationMs > 0 ? `，耗时 ${state.durationMs}ms` : ''}`
    }
    return '未检索'
  }

  const getTabStatusClass = (status: FileSearchStatus): string => {
    if (status === 'queued') return 'queued'
    if (status === 'searching') return 'searching'
    if (status === 'error') return 'error'
    if (status === 'cancelled') return 'warn'
    if (status === 'success' || status === 'done') return 'success'
    return ''
  }

  const getTabTitleWithStatus = (serverId: string, tabId: string): string => {
    const state = getFileSearchState(serverId, tabId)
    return `${getTabTitle(tabId)}\n${getFileSearchStatusText(state)}`
  }

  const activeServer = servers.find(s => s.id === activeServerId)
  const resultTabs = getResultTabs(activeServerId)
  const visibleResultTabs = activeServerId ? resultTabs : []
  const currentLogs = getCurrentLogs()
  const currentStats = getCurrentStats()
  const activeFileState = getFileSearchState(activeServerId, activeTabId)
  const activeResultWindow = currentScopeKey ? getResultWindow(currentScopeKey) : undefined
  const totalResultCount = Math.max(activeResultWindow?.total ?? 0, activeFileState.count)
  const activeResultCountKey = `${getCurrentRunId(activeServerId)}:${activeFileState.count}`
  const pendingJump = currentScopeKey ? pendingJumpRef.current[currentScopeKey] : undefined
  const pendingJumpRangeKey = pendingJump
    ? `${pendingJump.runId}:${pendingJump.renderStart}:${pendingJump.renderEnd}:${pendingJump.targetIndex}`
    : ''
  const visibleLogByIndex = React.useMemo(() => {
    return new Map(currentLogs.map(log => [log.index, log]))
  }, [currentLogs])
  const rangeExtractor = React.useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indexes = new Set(defaultRangeExtractor(range))
    const pending = currentScopeKey ? pendingJumpRef.current[currentScopeKey] : undefined
    if (pending) {
      for (let index = pending.renderStart; index <= pending.renderEnd; index++) {
        indexes.add(index)
      }
    }
    return Array.from(indexes).sort((left, right) => left - right)
  }, [currentScopeKey, pendingJumpRangeKey])
  const rowVirtualizer = useVirtualizer({
    count: totalResultCount,
    getScrollElement: () => consoleContainerRef.current,
    estimateSize: () => (wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT),
    getItemKey: (index) => {
      const runId = activeResultWindow?.runId ?? getCurrentRunId(activeServerId)
      return `${runId || 'run'}::${activeTabId || 'tab'}::${index}`
    },
    measureElement: wrapLines ? undefined : () => LOG_ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN_ROWS,
    rangeExtractor,
    useAnimationFrameWithResizeObserver: wrapLines,
    useFlushSync: false
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  useEffect(() => {
    if (!pendingJump) {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
      return
    }
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
    }
  }, [pendingJumpRangeKey, rowVirtualizer])

  useEffect(() => {
    rowVirtualizer.measure()
  }, [wrapLines, currentScopeKey, rowVirtualizer])

  useEffect(() => {
    return () => {
      if (scrollPeekFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollPeekFrameRef.current)
        scrollPeekFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!currentScopeKey || !activeResultWindow) return
    const pendingJump = pendingJumpRef.current[currentScopeKey]
    if (!pendingJump || pendingJump.runId !== activeResultWindow.runId) return
    if (activeResultWindow.loading || activeResultWindow.lines.length === 0) return

    const start = activeResultWindow.offset
    const end = activeResultWindow.offset + activeResultWindow.lines.length
    if (pendingJump.targetIndex < start || pendingJump.targetIndex >= end) {
      delete pendingJumpRef.current[currentScopeKey]
      return
    }

    window.requestAnimationFrame(() => {
      rowVirtualizer.measure()
      window.requestAnimationFrame(() => {
        rowVirtualizer.measure()
        rowVirtualizer.scrollToIndex(pendingJump.targetIndex, { align: pendingJump.align })
        window.requestAnimationFrame(() => {
          rowVirtualizer.scrollToIndex(pendingJump.targetIndex, { align: pendingJump.align })
          updateStoredScrollTop(currentScopeKey)
          delete pendingJumpRef.current[currentScopeKey]
        })
      })
    })
  }, [
    currentScopeKey,
    activeResultWindow?.runId,
    activeResultWindow?.offset,
    activeResultWindow?.lines,
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
    <main className={`app-shell ${sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''}`}>
      {/* 侧边栏：服务器配置选择 */}
      <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-topbar">
          <button
            className="sidebar-action-btn sidebar-collapse-btn"
            onClick={handleToggleSidebarCollapsed}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            type="button"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>

        <div className="sidebar-title-section">
          <span className="sidebar-title">连接服务器 ({servers.length})</span>
          <button
            className="sidebar-action-btn"
            onClick={handleAddNewServer}
            title="添加连接配置"
            type="button"
          >
            <Plus size={14} />
          </button>
        </div>

        <nav className="server-list">
          {servers.map(srv => (
            <button
              key={srv.id}
              className={`server-item ${activeServerId === srv.id ? 'active' : ''}`}
              onClick={() => handleSelectServer(srv)}
              title={sidebarCollapsed ? `${srv.name} · ${srv.type.toUpperCase()}` : srv.name}
              type="button"
            >
              <div className="server-item-left">
                <Server size={14} />
                <span className="server-name" title={srv.name}>{srv.name}</span>
                <span className="server-type-badge">{srv.type.toUpperCase()}</span>
              </div>
              <div className="server-item-actions">
                <button
                  className="server-item-btn"
                  onClick={(e) => handleEditServer(srv, e)}
                  title="修改配置"
                  type="button"
                >
                  <Settings size={12} />
                </button>
                <button
                  className="server-item-btn"
                  onClick={(e) => handleCloneServer(srv, e)}
                  title="克隆配置"
                  type="button"
                >
                  <Copy size={12} />
                </button>
                <button
                  className="server-item-btn"
                  onClick={(e) => handleDeleteServer(srv.id, e)}
                  title="删除配置"
                  type="button"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </button>
          ))}
          {servers.length === 0 && (
            <div style={{ padding: '20px 10px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
              暂无连接配置，请点击右上角添加。
            </div>
          )}
        </nav>
      </aside>

      {/* 主面板 */}
      <section className="main-content">
        {/* 顶部过滤控制台 */}
        <header className="toolbar">
          <div className="search-row">
            {/* 日志文件多选下拉控件 */}
            {activeServerId && (
              <div className="file-select-dropdown" ref={dropdownRef}>
                <button
                  className="btn btn-secondary dropdown-trigger"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  type="button"
                  title="选择需要检索的具体日志文件"
                >
                  <Folder size={14} />
                  <span className="trigger-text">
                    {isListLoadingMap[activeServerId]
                      ? '加载文件中...'
                      : (() => {
                          const selected = selectedFilesMap[activeServerId] || []
                          const available = availableFilesMap[activeServerId] || []
                          if (selected.length === 0) return '未选文件(默认前5个)'
                          if (selected.length === available.length) return '已选择全部文件'
                          return `已选 ${selected.length}/${available.length} 个文件`
                        })()}
                  </span>
                </button>

                {dropdownOpen && (
                  <div className="dropdown-menu">
                    <div className="dropdown-search">
                      <input
                        type="text"
                        placeholder="搜索文件名..."
                        value={fileFilterText}
                        onChange={(e) => setFileFilterText(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        spellCheck={false}
                      />
                    </div>
                    
                    <div className="dropdown-actions">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          const available = availableFilesMap[activeServerId] || []
                          setSelectedFilesMap(prev => ({ ...prev, [activeServerId]: [...available] }))
                        }}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedFilesMap(prev => ({ ...prev, [activeServerId]: [] }))
                        }}
                      >
                        清空
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          fetchAvailableFiles(activeServerId)
                        }}
                      >
                        刷新
                      </button>
                    </div>

                    <div className="dropdown-list">
                      {(() => {
                        const available = availableFilesMap[activeServerId] || []
                        const filtered = available.filter(f =>
                          f.toLowerCase().includes(fileFilterText.toLowerCase())
                        )
                        if (filtered.length === 0) {
                          return <div className="dropdown-empty">无匹配的文件</div>
                        }
                        const selected = selectedFilesMap[activeServerId] || []
                        return filtered.map(filePath => {
                          const isChecked = selected.includes(filePath)
                          const fileName = getLogFileName(filePath)
                          return (
                            <label key={filePath} className="dropdown-item" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  let nextSelected = [...selected]
                                  if (e.target.checked) {
                                    nextSelected.push(filePath)
                                  } else {
                                    nextSelected = nextSelected.filter(f => f !== filePath)
                                  }
                                  setSelectedFilesMap(prev => ({ ...prev, [activeServerId]: nextSelected }))
                                }}
                              />
                              <div className="file-info" title={filePath}>
                                <span className="file-name-span">{fileName}</span>
                                <span className="file-path-span">{filePath}</span>
                              </div>
                            </label>
                          )
                        })
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ position: 'relative', flex: 1 }}>
              <div className="searchbox">
                <Search size={15} style={{ color: 'var(--text-muted)' }} />
                <input
                  value={getSearchPattern(activeServerId)}
                  onChange={(e) => setSearchPatterns({ ...searchPatterns, [activeServerId]: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="输入检索关键字或正则表达式... (按下回车开始)"
                  disabled={getIsSearching(activeServerId)}
                  spellCheck={false}
                />
              </div>
              {toastMessage && (
                <div className="toast-bubble">
                  <AlertTriangle size={13} />
                  <span>{toastMessage}</span>
                </div>
              )}
            </div>
            
            {getIsSearching(activeServerId) ? (
              <button className="btn btn-danger" onClick={handleStopSearch} type="button">
                <XCircle size={15} />
                停止
              </button>
            ) : (
              <button className="btn btn-primary" onClick={handleSearch} disabled={!activeServerId} type="button">
                <Play size={14} />
                检索
              </button>
            )}

            <button
              className="btn btn-secondary"
              onClick={() => {
                if (editingServer && editingServer.id === activeServerId) {
                  setConfigPanelOpen(!configPanelOpen)
                } else {
                  const srv = servers.find(s => s.id === activeServerId)
                  if (srv) {
                    syncConfigPanelToServer(srv)
                    setConfigPanelOpen(true)
                  }
                }
              }}
              disabled={!activeServerId}
              type="button"
            >
              配置详情
            </button>
          </div>

          {/* Grep 参数面板 */}
          <div className="params-row">
            <label className="param-checkbox">
              <input
                type="checkbox"
                checked={getGrepArgs(activeServerId).ignoreCase}
                onChange={(e) => updateGrepArgs(activeServerId, { ignoreCase: e.target.checked })}
              />
              <span>忽略大小写</span>
            </label>

            <label className="param-checkbox">
              <input
                type="checkbox"
                checked={getGrepArgs(activeServerId).invert}
                onChange={(e) => updateGrepArgs(activeServerId, { invert: e.target.checked })}
              />
              <span>排除匹配行</span>
            </label>

            <label className="param-checkbox">
              <input
                type="checkbox"
                checked={getGrepArgs(activeServerId).wordRegexp}
                onChange={(e) => updateGrepArgs(activeServerId, { wordRegexp: e.target.checked })}
              />
              <span>只匹配完整词</span>
            </label>

            <label className="param-checkbox">
              <input
                type="checkbox"
                checked={getGrepArgs(activeServerId).regexp}
                onChange={(e) => updateGrepArgs(activeServerId, { regexp: e.target.checked })}
              />
              <span>使用正则</span>
            </label>

            <label className="param-checkbox">
              <input
                type="checkbox"
                checked={getGrepArgs(activeServerId).onlyMatch}
                disabled={getGrepArgs(activeServerId).invert}
                onChange={(e) => updateGrepArgs(activeServerId, { onlyMatch: e.target.checked })}
              />
              <span>只显示命中片段</span>
            </label>

            <div className="context-input">
              <span>上下文行数:</span>
              <input
                type="number"
                min="0"
                max="50"
                value={getGrepArgs(activeServerId).contextC}
                onChange={(e) => updateGrepArgs(activeServerId, { contextC: Math.max(0, parseInt(e.target.value) || 0) })}
              />
            </div>

            <div className="context-input">
              <span
                title="保留每个文件最新的 N 条命中，最终仍按日志原始顺序从旧到新展示。"
              >
                每文件最新:
              </span>
              <select
                value={getGrepArgs(activeServerId).maxCount}
                onChange={(e) => updateGrepArgs(activeServerId, { maxCount: parseInt(e.target.value) || 0 })}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-main)',
                  height: '22px',
                  padding: '0 4px',
                  outline: 0
                }}
              >
                <option value="500">500 行</option>
                <option value="1000">1000 行</option>
                <option value="2000">2000 行</option>
                <option value="5000">5000 行</option>
                <option value="10000">10000 行</option>
                <option value="0">无限制</option>
              </select>
            </div>

            <label className="param-checkbox">
              <input
                type="checkbox"
                checked={getGrepArgs(activeServerId).fromTail}
                onChange={(e) => updateGrepArgs(activeServerId, { fromTail: e.target.checked })}
              />
              <span>只搜尾部</span>
            </label>

            <div className="context-input">
              <span>尾部行数:</span>
              <input
                className="tail-lines-input"
                type="number"
                min="10"
                max="200000"
                value={getGrepArgs(activeServerId).tailLines}
                disabled={!getGrepArgs(activeServerId).fromTail}
                onChange={(e) => updateGrepArgs(activeServerId, { tailLines: Math.max(10, parseInt(e.target.value) || 1000) })}
              />
            </div>

            <button
              className={`inline-tool-btn ${highlightPanelOpen ? 'active' : ''}`}
              onClick={handleToggleHighlightPanel}
              type="button"
              title="配置红色、黄色、绿色状态高亮词"
            >
              <Palette size={12} />
              高亮词
            </button>
          </div>

          <div className="filter-chain">
            <div className="filter-chain-header">
              <span>链式过滤</span>
              <button
                className="filter-add-btn"
                onClick={() => handleAddExtraFilter(activeServerId)}
                disabled={!activeServerId || getIsSearching(activeServerId)}
                type="button"
              >
                <Plus size={12} />
                添加过滤
              </button>
            </div>
            {getExtraFilters(activeServerId).length > 0 && (
              <div className="filter-list">
                {getExtraFilters(activeServerId).map((filter, index) => (
                  <div className="filter-item" key={`${activeServerId}_${index}`}>
                    <span className="filter-index">继续过滤 {index + 2}</span>
                    <input
                      className="filter-pattern-input"
                      value={filter.pattern}
                      onChange={(e) => handleUpdateExtraFilter(activeServerId, index, { pattern: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="继续过滤关键词或正则"
                      disabled={getIsSearching(activeServerId)}
                      spellCheck={false}
                    />
                    <label className="param-checkbox compact">
                      <input
                        type="checkbox"
                        checked={filter.ignoreCase}
                        onChange={(e) => handleUpdateExtraFilter(activeServerId, index, { ignoreCase: e.target.checked })}
                        disabled={getIsSearching(activeServerId)}
                      />
                      <span>忽略大小写</span>
                    </label>
                    <label className="param-checkbox compact">
                      <input
                        type="checkbox"
                        checked={filter.invert}
                        onChange={(e) => handleUpdateExtraFilter(activeServerId, index, { invert: e.target.checked })}
                        disabled={getIsSearching(activeServerId)}
                      />
                      <span>排除</span>
                    </label>
                    <label className="param-checkbox compact">
                      <input
                        type="checkbox"
                        checked={filter.wordRegexp}
                        onChange={(e) => handleUpdateExtraFilter(activeServerId, index, { wordRegexp: e.target.checked })}
                        disabled={getIsSearching(activeServerId)}
                      />
                      <span>整词</span>
                    </label>
                    <label className="param-checkbox compact">
                      <input
                        type="checkbox"
                        checked={filter.regexp}
                        onChange={(e) => handleUpdateExtraFilter(activeServerId, index, { regexp: e.target.checked })}
                        disabled={getIsSearching(activeServerId)}
                      />
                      <span>正则</span>
                    </label>
                    <button
                      className="filter-remove-btn"
                      onClick={() => handleRemoveExtraFilter(activeServerId, index)}
                      disabled={getIsSearching(activeServerId)}
                      title="移除过滤条件"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {highlightPanelOpen && (
            <div className="highlight-config-panel">
              <div className="highlight-config-header">
                <div>
                  <span className="highlight-config-title">状态高亮词</span>
                  <span className="highlight-config-hint">固定使用 {HIGHLIGHT_WORD_SEPARATOR} 分隔，例如 error|exception|错误|失败</span>
                </div>
                <button className="filter-add-btn" onClick={resetHighlightKeywords} type="button">
                  恢复默认
                </button>
              </div>
              <div className="highlight-config-grid">
                <label className="highlight-config-item">
                  <span>
                    <i className="highlight-swatch highlight-swatch-error" />
                    红色
                  </span>
                  <textarea
                    value={highlightKeywords['status-error']}
                    onChange={(e) => updateHighlightKeywords('status-error', e.target.value)}
                    placeholder="error|exception|错误|失败"
                    spellCheck={false}
                  />
                </label>
                <label className="highlight-config-item">
                  <span>
                    <i className="highlight-swatch highlight-swatch-warning" />
                    黄色
                  </span>
                  <textarea
                    value={highlightKeywords['status-warning']}
                    onChange={(e) => updateHighlightKeywords('status-warning', e.target.value)}
                    placeholder="warning|warn|警告|告警"
                    spellCheck={false}
                  />
                </label>
                <label className="highlight-config-item">
                  <span>
                    <i className="highlight-swatch highlight-swatch-success" />
                    绿色
                  </span>
                  <textarea
                    value={highlightKeywords['status-success']}
                    onChange={(e) => updateHighlightKeywords('status-success', e.target.value)}
                    placeholder="success|ok|成功|完成"
                    spellCheck={false}
                  />
                </label>
              </div>
            </div>
          )}
        </header>

        {/* 核心工作区 */}
        <section className={`workspace ${configPanelOpen ? 'workspace-with-config' : ''}`}>
          {/* 日志结果展示 */}
          <div className="results-pane">
            <div className="results-header">
              <div>
                当前连接: <strong>{activeServer ? activeServer.name : '未选择'}</strong>
                {activeServer && ` (${activeServer.host})`}
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {currentStats.count > 0 && (
                  <span>
                    匹配: <strong>{currentStats.count}</strong> 行
                    {currentStats.durationMs > 0 && ` (耗时 ${currentStats.durationMs}ms)`}
                    {currentStats.truncated && '，已截断旧结果'}
                  </span>
                )}
                <button
                  className={`sidebar-action-btn results-mode-btn ${wrapLines ? 'active' : ''}`}
                  onClick={handleToggleWrapLines}
                  title={wrapLines ? '当前为自动换行模式，点击切换到单行极速模式' : '当前为单行极速模式，点击切换到自动换行'}
                  type="button"
                  aria-pressed={wrapLines}
                >
                  <TextWrap size={12} />
                  <span>{wrapLines ? '换行' : '单行'}</span>
                </button>
                {currentLogs.length > 0 && (
                  <button className="sidebar-action-btn" onClick={handleCopyLogs} title="复制当前已加载视图" type="button">
                    <Copy size={12} />
                  </button>
                )}
              </div>
            </div>

            {visibleResultTabs.length > 1 && (
              <div className="result-tabs" role="tablist" aria-label="日志文件结果视图">
                {visibleResultTabs.map(tabId => {
                  const tabStats = getFileSearchState(activeServerId, tabId)

                  return (
                    <button
                      key={tabId}
                      className={`result-tab ${activeTabId === tabId ? 'active' : ''}`}
                      onClick={() => setActiveResultTabsMap(prev => ({ ...prev, [activeServerId]: tabId }))}
                      title={getTabTitleWithStatus(activeServerId, tabId)}
                      role="tab"
                      aria-selected={activeTabId === tabId}
                      type="button"
                    >
                      <span className={`result-tab-dot ${getTabStatusClass(tabStats.status)}`} />
                      <span className="result-tab-label">{getTabLabel(tabId)}</span>
                      {tabStats.count > 0 && <span className="result-tab-count">{tabStats.count}</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Ctrl+F 查找框 */}
            {showFindBar && (
              <div className="find-popover">
                <input
                  ref={findInputRef}
                  className="find-bar-input"
                  type="text"
                  placeholder="查找"
                  value={findKeyword}
                  onChange={e => setFindKeyword(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      setShowFindBar(false)
                      setFindKeyword('')
                      if (currentScopeKey) {
                        setFindResultMap(prev => ({ ...prev, [currentScopeKey]: null }))
                      }
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleFindNavigate(e.shiftKey ? 'prev' : 'next')
                    }
                  }}
                />
                <span className="find-bar-count">
                  {(() => {
                    const findResult = currentScopeKey ? findResultMap[currentScopeKey] : null
                    if (!findKeyword) return ''
                    if (findResult?.keyword === findKeyword.trim()) {
                      return findResult.total > 0 ? `${findResult.ordinal}/${findResult.total}` : '0 处'
                    }
                    return `${findMatchCount} 处`
                  })()}
                </span>
                <button
                  className="find-bar-nav"
                  onClick={() => handleFindNavigate('prev')}
                  disabled={!findKeyword.trim() || findLoading}
                  title="上一个 (Shift+Enter)"
                  type="button"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="find-bar-nav"
                  onClick={() => handleFindNavigate('next')}
                  disabled={!findKeyword.trim() || findLoading}
                  title="下一个 (Enter)"
                  type="button"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  className="find-bar-close"
                  onClick={() => {
                    setShowFindBar(false)
                    setFindKeyword('')
                    if (currentScopeKey) {
                      setFindResultMap(prev => ({ ...prev, [currentScopeKey]: null }))
                    }
                  }}
                  title="关闭"
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div className={`results-console ${showFindBar ? 'results-console-with-find' : ''}`} ref={consoleContainerRef} onScroll={handleScroll}>
              {(() => {
                const currentIsSearching = activeFileState.active

                if (totalResultCount === 0) {
                  if (activeFileState.status === 'error') {
                    return (
                      <div className="empty-state empty-state-error">
                        <AlertTriangle size={32} />
                        <h3>文件检索失败</h3>
                        <p className="empty-state-message">{activeFileState.message || '未知错误'}</p>
                        <p className="empty-state-detail">{getTabTitle(activeTabId)}</p>
                      </div>
                    )
                  }
                  if (activeFileState.status === 'queued') {
                    return (
                      <div className="empty-state">
                        <div className="status-dot warn" style={{ width: '12px', height: '12px', marginBottom: '8px' }} />
                        <h3>等待检索...</h3>
                        <p style={{ fontSize: '12px' }}>前面的日志文件完成后，会自动检索当前文件。</p>
                      </div>
                    )
                  }
                  if (activeFileState.status === 'cancelled') {
                    return (
                      <div className="empty-state">
                        <XCircle size={32} style={{ opacity: 0.55 }} />
                        <h3>检索已取消</h3>
                        <p style={{ fontSize: '12px' }}>当前文件没有继续输出日志结果。</p>
                      </div>
                    )
                  }
                  if (!currentIsSearching) {
	                    return (
	                      <div className="empty-state">
	                        <Search size={32} style={{ opacity: 0.4 }} />
	                        <h3>暂无检索结果</h3>
                        <p style={{ fontSize: '12px' }}>请输入搜索文本，或确认是否启用了日志文件路径。</p>
                      </div>
                    )
                  } else {
                    return (
                      <div className="empty-state">
                        <div className="status-dot active" style={{ width: '12px', height: '12px', marginBottom: '8px' }} />
                        <h3>流式连接检索中...</h3>
                        <p style={{ fontSize: '12px' }}>Go 后端正在扫描日志中，稍后结果会自动输出在此处。</p>
                      </div>
                    )
                  }
                }

                const errorBanner = activeFileState.status === 'error' ? (
                  <div className="result-error-banner">
                    <AlertTriangle size={14} />
                    <span>当前文件检索失败: {activeFileState.message || '未知错误'}</span>
                  </div>
                ) : null

                return (
                  <>
                    {errorBanner}
                    <div
                      className={`virtual-log-list ${wrapLines ? 'virtual-log-list-wrap' : 'virtual-log-list-single'}`}
                      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                      {virtualRows.map((virtualRow) => {
                        const log = visibleLogByIndex.get(virtualRow.index)
                        if (!log) {
                          return (
                            <div
                              key={virtualRow.key}
                              className={`log-row log-row-placeholder ${wrapLines ? 'log-row-wrap' : ''}`}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                minHeight: wrapLines ? undefined : `${LOG_ROW_HEIGHT}px`,
                                transform: `translateY(${virtualRow.start}px)`
                              }}
                            >
                              <div className="log-content log-content-placeholder" />
                            </div>
                          )
                        }

                        return (
                          <div
                            key={virtualRow.key}
                            ref={wrapLines ? rowVirtualizer.measureElement : undefined}
                            data-index={virtualRow.index}
                            className={`log-row ${wrapLines ? 'log-row-wrap' : ''} ${log.error ? 'log-row-error' : ''}`}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              minHeight: wrapLines ? undefined : `${LOG_ROW_HEIGHT}px`,
                              height: wrapLines ? undefined : `${LOG_ROW_HEIGHT}px`,
                              transform: `translateY(${virtualRow.start}px)`
                            }}
                          >
                            <div className="log-content">
                              {renderHighlightedContent(log)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
            </div>

            {totalResultCount > 0 && (
              <div className="results-jump-controls" aria-label="日志结果快速滚动">
                <button
                  className="results-jump-btn"
                  onClick={handleJumpToTop}
                  title="到顶部"
                  type="button"
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  className="results-jump-btn"
                  onClick={handleJumpToBottom}
                  title="到底部"
                  type="button"
                >
                  <ChevronDown size={15} />
                </button>
              </div>
            )}

          </div>

          {/* 右侧服务器配置详情/修改面板 */}
          {configPanelOpen && editingServer && (
            <aside className="config-pane">
              <div className="config-header">
                <span className="config-title">
                  {servers.some(s => s.id === editingServer.id) ? '配置详情' : '添加连接'}
                </span>
                <button
                  className="sidebar-action-btn"
                  onClick={() => {
                    setConfigPanelOpen(false)
                    setEditingServer(null)
                    setConnectionTest({ status: 'idle', message: '' })
                  }}
                  type="button"
                >
                  <XCircle size={16} />
                </button>
              </div>

              <div className="config-form">
                <div className="form-group">
                  <label>连接名称 *</label>
                  <input
                    type="text"
                    value={editingServer.name}
                    onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
                    placeholder="例如：开发环境 nginx"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>连接类型</label>
                    <select
                      value={editingServer.type}
                      onChange={(e) => setEditingServer({ ...editingServer, type: e.target.value as 'local' | 'ssh' })}
                    >
                      <option value="local">本地日志 (Local)</option>
                      <option value="ssh">远程 SSH (SSH)</option>
                    </select>
                  </div>

                  {editingServer.type === 'ssh' && (
                    <div className="form-group">
                      <label>SSH 端口</label>
                      <input
                        type="number"
                        value={editingServer.port || 22}
                        onChange={(e) => setEditingServer({ ...editingServer, port: parseInt(e.target.value) || 22 })}
                        placeholder="22"
                      />
                    </div>
                  )}
                </div>

                {editingServer.type === 'ssh' && (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>主机 IP/域名 *</label>
                        <input
                          type="text"
                          value={editingServer.host}
                          onChange={(e) => setEditingServer({ ...editingServer, host: e.target.value })}
                          placeholder="192.168.1.100"
                        />
                      </div>
                      <div className="form-group">
                        <label>SSH 用户名 *</label>
                        <input
                          type="text"
                          value={editingServer.user}
                          onChange={(e) => setEditingServer({ ...editingServer, user: e.target.value })}
                          placeholder="root"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>鉴权方式</label>
                      <select
                        value={editingServer.authType}
                        onChange={(e) => setEditingServer({ ...editingServer, authType: e.target.value as 'password' | 'key' })}
                      >
                        <option value="password">SSH 密码</option>
                        <option value="key">SSH 私钥 (Key)</option>
                      </select>
                    </div>

                    {editingServer.authType === 'password' ? (
                      <div className="form-group">
                        <label>SSH 密码</label>
                        <input
                          type="password"
                          value={editingServer.password || ''}
                          onChange={(e) => setEditingServer({ ...editingServer, password: e.target.value })}
                          placeholder="远程登录密码"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="form-group">
                          <label>私钥文件物理路径 (优先)</label>
                          <input
                            type="text"
                            value={editingServer.keyPath || ''}
                            onChange={(e) => setEditingServer({ ...editingServer, keyPath: e.target.value })}
                            placeholder="C:\Users\username\.ssh\id_rsa"
                          />
                        </div>
                        <div className="form-group">
                          <label>私钥文本内容</label>
                          <textarea
                            value={editingServer.keyText || ''}
                            onChange={(e) => setEditingServer({ ...editingServer, keyText: e.target.value })}
                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                            spellCheck={false}
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* 日志路径管理 */}
                <div className="form-group">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>检索日志路径 ({editingServer.logs.length})</span>
                    <button
                      className="sidebar-action-btn"
                      onClick={handleAddLogPath}
                      title="添加日志路径"
                      type="button"
                      style={{ padding: '2px 6px', fontSize: '11px', display: 'flex', gap: '3px' }}
                    >
                      <Plus size={10} /> 路径
                    </button>
                  </label>
                  
                  <div className="path-list">
                    {editingServer.logs.map((logConf, index) => (
                      <div key={index} className="path-item">
                        <input
                          type="checkbox"
                          checked={logConf.enabled}
                          onChange={(e) => handleUpdateLogPath(index, { enabled: e.target.checked })}
                          style={{ accentColor: 'var(--accent-color)', cursor: 'pointer' }}
                        />
                        <input
                          type="text"
                          value={logConf.path}
                          onChange={(e) => handleUpdateLogPath(index, { path: e.target.value })}
                          placeholder={editingServer.type === 'local' ? "d:/logs/nginx/*.log" : "/var/log/nginx/*.log"}
                          spellCheck={false}
                        />
                        <button
                          className="server-item-btn"
                          onClick={() => handleRemoveLogPath(index)}
                          title="移除路径"
                          type="button"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="config-footer">
                {connectionTest.message && (
                  <div className={`connection-test-message ${connectionTest.status}`}>
                    {connectionTest.message}
                  </div>
                )}
                <div className="config-footer-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={handleTestConnection}
                    disabled={connectionTest.status === 'testing'}
                    type="button"
                  >
                    <PlugZap size={14} />
                    {connectionTest.status === 'testing' ? '测试中' : '测试连接'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setConfigPanelOpen(false)
                      setEditingServer(null)
                      setConnectionTest({ status: 'idle', message: '' })
                    }}
                    type="button"
                  >
                    取消
                  </button>
                  <button className="btn btn-primary" onClick={handleSaveForm} type="button">
                    <Check size={14} />
                    保存
                  </button>
                </div>
              </div>
            </aside>
          )}
        </section>

        {/* 底部状态栏 */}
        <footer className="statusbar">
          <div className="status-left">
            <div className={`status-dot ${statusDot}`} />
            <span>{statusMessage}</span>
          </div>
          <div>Go Runtime BPP 0.1.0</div>
        </footer>
      </section>
    </main>
  )
}
