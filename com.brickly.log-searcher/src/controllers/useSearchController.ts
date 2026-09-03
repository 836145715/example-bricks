import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import type {
  BricklySearchEvent,
  FindResult,
  GrepArgs,
  ParsedLogLine,
  PeekResult,
  ServerConfig,
  WorkspaceState
} from '../types'
import { DEFAULT_GREP_ARGS } from '../types'
import {
  getDefaultSelectedFiles,
  isSearchableLogFile,
  normalizeRemoteLogFiles,
  sortRemoteLogFilesByModifiedAt
} from '../domain/logFiles'
import {
  isDateFilterActive,
  pathsMatchingDateFilter,
  type RemoteBrowseResult
} from '../domain/paths'
import { getJumpPeekWindow, type JumpAlign } from '../virtualJump'
import type { WorkspaceAction } from '../state/workspaceActions'
import { makeScopeKey, isServerScopeKey } from '../state/workspaceHelpers'
import { resolveActiveResultTab } from '../resultDisplay'

const LOG_ROW_HEIGHT = 22
const WRAPPED_LOG_ROW_ESTIMATE_HEIGHT = 36
const VIRTUAL_OVERSCAN_ROWS = 12
const PEEK_MAX_LIMIT = 1000
const PEEK_DEBOUNCE_MS = 35

const makePeekSignature = (
  runId: string,
  tabId: string,
  offset: number,
  limit: number,
  totalHint: number
): string => `${runId}::${tabId}::${offset}::${limit}::${totalHint}`

export interface PendingJump {
  runId: string
  targetIndex: number
  align: JumpAlign
  renderStart: number
  renderEnd: number
}

interface UseSearchControllerOptions {
  state: WorkspaceState
  dispatch: React.Dispatch<WorkspaceAction>
  runtimeRef: React.MutableRefObject<BricklyStartedHandle | null>
  showToast: (msg: string) => void
  showStatus: (msg: string, dot?: 'active' | 'warn' | 'error' | '') => void
}

/**
 * 搜索与数据交互中介者 Hook（Controller / Mediator 模式）
 * 集中管理 RPC 调用、搜索调度、文件加载、视口 Peek 与跳转。
 */
export function useSearchController({
  state,
  dispatch,
  runtimeRef,
  showToast,
  showStatus
}: UseSearchControllerOptions) {
  const stateRef = useRef(state)
  stateRef.current = state

  // 引用管理异步批次与会话句柄
  const serverBatchRunIdsRef = useRef<Record<string, number>>({})
  const fileListRequestIDsRef = useRef<Record<string, number>>({})
  const fileListRetryTimersRef = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({})
  const peekTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const peekRequestSignaturesRef = useRef<Record<string, string>>({})
  const pendingJumpRef = useRef<Record<string, PendingJump>>({})
  const activeAbortControllersRef = useRef<Record<string, AbortController>>({})

  // 清理所有定时器
  useEffect(() => {
    return () => {
      for (const timer of Object.values(fileListRetryTimersRef.current)) {
        window.clearTimeout(timer)
      }
      if (peekTimerRef.current) {
        window.clearTimeout(peekTimerRef.current)
      }
      for (const ctrl of Object.values(activeAbortControllersRef.current)) {
        ctrl.abort()
      }
    }
  }, [])

  /** 底座命令执行代理 */
  const invokeSelf = useCallback(<TResult = unknown>(commandId: string, input: Record<string, unknown> = {}) => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return Promise.reject(new Error('Runtime 尚未就绪，请稍后重试'))
    }
    return runtime.invoke<TResult>(commandId, input)
  }, [runtimeRef])

  /** 将 Go 返回的行数据转换为 UI 呈现结构 */
  const toParsedLogLine = useCallback((scopeKey: string, runId: string, line: PeekResult['lines'][number]): ParsedLogLine => ({
    id: `log_${runId}_${scopeKey}_${line.index}`,
    index: line.index,
    file: line.file || '',
    content: line.text,
    isContext: !!line.isContext,
    error: line.error,
    matches: Array.isArray(line.matches) ? line.matches : []
  }), [])

  /** 清理指定服务器的 Peek 追踪缓存 */
  const clearPeekTrackingForServer = useCallback((serverId: string) => {
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
  }, [])

  /** 加载配置 */
  const loadAppConfig = useCallback(async () => {
    if (!runtimeRef.current) return
    try {
      const res = await invokeSelf<{ config?: { servers?: ServerConfig[] } }>('load_config')
      const servers = res.config?.servers || []
      dispatch({ type: 'SET_SERVERS', servers })
      if (servers.length > 0 && !stateRef.current.activeServerId) {
        dispatch({ type: 'SELECT_SERVER', serverId: servers[0].id })
      }
      showStatus('配置加载成功', 'active')
    } catch (err: any) {
      showStatus(`配置加载失败: ${err.message || err}`, 'error')
    }
  }, [invokeSelf, dispatch, runtimeRef, showStatus])

  /** 保存配置 */
  const saveAppConfig = useCallback(async (nextServers: ServerConfig[]) => {
    if (!runtimeRef.current) return
    try {
      await invokeSelf('save_config', { config: { servers: nextServers } })
      dispatch({ type: 'SET_SERVERS', servers: nextServers })
      showStatus('配置保存成功', 'active')
    } catch (err: any) {
      showStatus(`配置保存失败: ${err.message || err}`, 'error')
    }
  }, [invokeSelf, dispatch, runtimeRef, showStatus])

  /** 异步拉取远程文件列表 */
  const fetchAvailableFiles = useCallback(async (serverId: string, attempt = 0, requestID?: number) => {
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

    dispatch({ type: 'SET_FILE_LIST_STATUS', serverId, status: 'loading' })

    try {
      const res = await invokeSelf('list_log_files', { serverId })
      if (fileListRequestIDsRef.current[serverId] !== activeRequestID) return

      const files = sortRemoteLogFilesByModifiedAt(
        normalizeRemoteLogFiles(res).filter(isSearchableLogFile)
      )
      const sortedFilePaths = files.map(file => file.path)

      dispatch({ type: 'SET_FILES', serverId, files, status: 'ready' })

      // 日期筛选检测与自动选择
      const ws = stateRef.current.workspaces[serverId]
      const server = stateRef.current.servers.find(s => s.id === serverId)
      if (ws && server) {
        if (isDateFilterActive(ws.draft.dateFilter)) {
          dispatch({
            type: 'UPDATE_DRAFT',
            serverId,
            draft: { selectedFiles: pathsMatchingDateFilter(files, ws.draft.dateFilter) }
          })
        } else if (ws.draft.selectedFiles.length === 0) {
          const defaults = getDefaultSelectedFiles(sortedFilePaths, server.logs)
          dispatch({ type: 'UPDATE_DRAFT', serverId, draft: { selectedFiles: defaults } })
        }
      }
    } catch (err: any) {
      if (fileListRequestIDsRef.current[serverId] !== activeRequestID) return
      const maxAttempts = 3
      if (attempt < maxAttempts - 1) {
        fileListRetryTimersRef.current[serverId] = window.setTimeout(() => {
          fetchAvailableFiles(serverId, attempt + 1, activeRequestID)
        }, 500)
        return
      }
      dispatch({ type: 'SET_FILE_LIST_STATUS', serverId, status: 'error' })
      showToast(`获取文件列表失败: ${err.message || err}`)
    }
  }, [invokeSelf, dispatch, runtimeRef, showToast])

  const isCurrentPeekRun = useCallback((serverId: string, requestedRunId: string, resultRunId?: string) => {
    const currentRunId = stateRef.current.workspaces[serverId]?.job.runId
    if (!currentRunId || currentRunId !== requestedRunId) return false
    if (resultRunId !== undefined && resultRunId !== requestedRunId) return false
    return true
  }, [])

  const resolveJobTabId = useCallback((serverId: string) => {
    const ws = stateRef.current.workspaces[serverId]
    if (!ws) return ''
    return resolveActiveResultTab(ws.job.tabs, ws.job.fileStates, ws.job.activeTabId)
  }, [])

  /** 视口 Peek 获取日志切片 */
  const peekResultWindow = useCallback(async (
    serverId: string,
    runId: string,
    tabId: string,
    offset: number,
    limit: number
  ) => {
    if (!runtimeRef.current || !serverId || !runId || !tabId) return
    if (!isCurrentPeekRun(serverId, runId)) return
    const scopeKey = makeScopeKey(serverId, tabId)
    dispatch({ type: 'SET_RESULT_WINDOW_LOADING', scopeKey, runId, loading: true })

    try {
      const result = await invokeSelf<PeekResult>('peek_search_results', {
        serverId,
        runId,
        tabId,
        offset,
        limit
      })

      if (!isCurrentPeekRun(serverId, runId, result.runId)) {
        dispatch({ type: 'SET_RESULT_WINDOW_LOADING', scopeKey, runId, loading: false })
        return
      }

      const pendingJump = pendingJumpRef.current[scopeKey]
      if (pendingJump?.runId === result.runId) {
        const resultEnd = result.offset + result.lines.length
        if (pendingJump.targetIndex < result.offset || pendingJump.targetIndex >= resultEnd) {
          dispatch({ type: 'SET_RESULT_WINDOW_LOADING', scopeKey, runId, loading: false })
          return
        }
      }

      const parsedLines = result.lines.map(line => toParsedLogLine(scopeKey, result.runId, line))
      dispatch({
        type: 'SET_RESULT_WINDOW',
        scopeKey,
        window: {
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
      })
    } catch (err: any) {
      if (pendingJumpRef.current[scopeKey]?.runId === runId) {
        delete pendingJumpRef.current[scopeKey]
      }
      dispatch({
        type: 'SET_RESULT_WINDOW_ERROR',
        scopeKey,
        runId,
        error: err?.message || String(err)
      })
    }
  }, [invokeSelf, dispatch, isCurrentPeekRun, runtimeRef, toParsedLogLine])

  /** 开始快速跳转定位 */
  const beginJump = useCallback((
    targetIndex: number,
    align: JumpAlign,
    containerHeight: number,
    wrapLines: boolean
  ) => {
    const activeServerId = stateRef.current.activeServerId
    const ws = stateRef.current.workspaces[activeServerId]
    if (!activeServerId || !ws) return
    const activeTabId = resolveJobTabId(activeServerId)
    if (!activeTabId) return
    const currentScopeKey = makeScopeKey(activeServerId, activeTabId)
    const fileState = ws.job.fileStates[activeTabId]
    const totalCount = fileState?.count ?? 0
    if (totalCount <= 0) return

    const runId = ws.job.runId
    const estimatedRowHeight = wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT
    const visibleCount = Math.max(1, Math.ceil((containerHeight || 600) / estimatedRowHeight))
    const peekWindow = getJumpPeekWindow(
      totalCount,
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

    if (runId && runtimeRef.current) {
      peekRequestSignaturesRef.current[currentScopeKey] = ''
      peekResultWindow(activeServerId, runId, activeTabId, peekWindow.offset, peekWindow.limit)
    }
  }, [peekResultWindow, resolveJobTabId, runtimeRef])

  /** 调度当前视口 Peek（带防抖） */
  const schedulePeekCurrentWindow = useCallback((
    visibleRange: { startIndex: number; endIndex: number },
    containerHeight: number,
    wrapLines: boolean
  ) => {
    const activeServerId = stateRef.current.activeServerId
    const ws = stateRef.current.workspaces[activeServerId]
    if (!activeServerId || !ws || !runtimeRef.current) return
    const runId = ws.job.runId
    const activeTabId = resolveJobTabId(activeServerId)
    if (!runId || !activeTabId) return

    const scopeKey = makeScopeKey(activeServerId, activeTabId)
    if (pendingJumpRef.current[scopeKey]?.runId === runId) return
    const fileState = ws.job.fileStates[activeTabId]
    if (!fileState || (fileState.count <= 0 && !fileState.active)) return

    const estimatedRowHeight = wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT
    const hasRange = visibleRange.endIndex >= visibleRange.startIndex && (visibleRange.endIndex > 0 || visibleRange.startIndex > 0)
    let startIndex = 0
    let limit = 50

    if (hasRange) {
      const visibleCount = Math.max(visibleRange.endIndex - visibleRange.startIndex + 1, 1)
      const prefetchCount = Math.max(visibleCount, VIRTUAL_OVERSCAN_ROWS)
      startIndex = Math.max(0, visibleRange.startIndex - prefetchCount)
      limit = Math.min(PEEK_MAX_LIMIT, Math.max(visibleCount + prefetchCount * 2, 50))
    } else {
      const visibleCount = Math.ceil(containerHeight / estimatedRowHeight)
      startIndex = 0
      limit = Math.min(PEEK_MAX_LIMIT, Math.max(visibleCount * 3, 50))
    }

    if (fileState.count > 0) {
      limit = Math.min(limit, Math.max(fileState.count - startIndex, 0))
    }
    if (limit <= 0) return

    const signature = makePeekSignature(runId, activeTabId, startIndex, limit, fileState.count)
    if (peekRequestSignaturesRef.current[scopeKey] === signature) return

    if (peekTimerRef.current) {
      window.clearTimeout(peekTimerRef.current)
    }

    peekTimerRef.current = window.setTimeout(() => {
      peekRequestSignaturesRef.current[scopeKey] = signature
      peekResultWindow(activeServerId, runId, activeTabId, startIndex, limit)
    }, PEEK_DEBOUNCE_MS)
  }, [peekResultWindow, resolveJobTabId, runtimeRef])

  /** 停止指定服务器的搜索 */
  const handleStopSearchForServer = useCallback((serverId: string, showUserStatus = true) => {
    if (!serverId) return
    serverBatchRunIdsRef.current[serverId] = (serverBatchRunIdsRef.current[serverId] ?? 0) + 1
    clearPeekTrackingForServer(serverId)

    const ctrl = activeAbortControllersRef.current[serverId]
    if (ctrl) {
      ctrl.abort()
      delete activeAbortControllersRef.current[serverId]
    }

    dispatch({ type: 'CANCEL_SEARCH', serverId })

    if (showUserStatus && stateRef.current.activeServerId === serverId) {
      showStatus('查询已由用户中止', 'warn')
    }
  }, [clearPeekTrackingForServer, dispatch, showStatus])

  /** 启动搜索 */
  const handleSearch = useCallback(async () => {
    const activeServerId = stateRef.current.activeServerId
    if (!activeServerId) {
      showToast('请先添加并选择服务器配置')
      return
    }

    const ws = stateRef.current.workspaces[activeServerId]
    const server = stateRef.current.servers.find(s => s.id === activeServerId)
    if (!ws || !server) {
      showStatus('当前服务器配置不存在，请重新选择连接。', 'error')
      return
    }

    if (ws.job.isSearching) return
    if (!ws.draft.pattern.trim()) {
      showToast('请输入查询关键词或正则表达式')
      return
    }
    if (!runtimeRef.current) {
      showStatus('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用。', 'error')
      return
    }

    handleStopSearchForServer(activeServerId, false)
    clearPeekTrackingForServer(activeServerId)

    const effectiveExtraFilters = ws.draft.filters.filter(filter => filter.pattern.trim() !== '')
    const searchArgs: GrepArgs = {
      ...ws.draft.grepArgs,
      tailBytes: ws.draft.grepArgs.tailBytes ?? DEFAULT_GREP_ARGS.tailBytes,
      filters: effectiveExtraFilters
    }

    const availableFiles = ws.files.availableFiles
    const availableFilePaths = availableFiles.map(file => file.path)
    if (availableFiles.length === 0) {
      if (ws.files.status === 'loading' || ws.files.status === 'idle') {
        showToast('日志文件仍在加载，请稍后再试')
      } else {
        showToast('日志文件列表不可用，请刷新后再试')
      }
      return
    }

    const filesToSearch = ws.draft.selectedFiles.length > 0
      ? ws.draft.selectedFiles.filter(file => availableFilePaths.includes(file))
      : availableFilePaths.slice(0, 5)

    if (filesToSearch.length === 0) {
      showToast('请先选择至少一个日志文件')
      return
    }

    const fileTabs = filesToSearch
    const batchRunId = (serverBatchRunIdsRef.current[activeServerId] ?? 0) + 1
    serverBatchRunIdsRef.current[activeServerId] = batchRunId

    dispatch({
      type: 'START_SEARCH',
      serverId: activeServerId,
      tabs: fileTabs
    })

    showStatus(`正在检索 ${fileTabs.length} 个日志视图...`, 'warn')

    const abort = new AbortController()
    activeAbortControllersRef.current[activeServerId] = abort

    try {
      const result = await runtimeRef.current.call('search', {
        serverId: activeServerId,
        pattern: ws.draft.pattern,
        args: searchArgs,
        files: filesToSearch
      }, {
        signal: abort.signal,
        onEvent(raw) {
          if (serverBatchRunIdsRef.current[activeServerId] !== batchRunId) return
          const event = raw as BricklySearchEvent
          if (event?.type === 'progress' && stateRef.current.activeServerId === activeServerId) {
            showStatus(event.message || `正在检索 ${fileTabs.length} 个日志视图...`, 'warn')
          }
          if (event?.type === 'searchState' && event.searchState) {
            dispatch({ type: 'UPDATE_SEARCH_STATE', payload: event.searchState })
          }
        }
      }) as { runId?: string } | undefined

      if (serverBatchRunIdsRef.current[activeServerId] !== batchRunId) return
      if (result?.runId) {
        dispatch({ type: 'SET_SEARCH_RUN_ID', serverId: activeServerId, runId: String(result.runId) })
      }
      dispatch({ type: 'FINISH_SEARCH', serverId: activeServerId })

      const currentWs = stateRef.current.workspaces[activeServerId]
      if (currentWs) {
        const total = Object.values(currentWs.job.fileStates).reduce((sum, s) => sum + s.count, 0)
        showStatus(`检索完成，共找到 ${total} 条匹配`, 'active')
      }
    } catch (err: any) {
      if (serverBatchRunIdsRef.current[activeServerId] !== batchRunId) return
      const message = err?.message || String(err)
      if (/CANCELLED/i.test(message)) return

      dispatch({ type: 'FINISH_SEARCH', serverId: activeServerId, error: message || '未知错误' })
      showStatus(`检索出错: ${message || '未知错误'}`, 'error')
    } finally {
      if (activeAbortControllersRef.current[activeServerId] === abort) {
        delete activeAbortControllersRef.current[activeServerId]
      }
    }
  }, [clearPeekTrackingForServer, dispatch, handleStopSearchForServer, runtimeRef, showStatus, showToast])

  /** Ctrl+F 查找上一个 / 下一个 */
  const handleFindNavigate = useCallback(async (
    direction: 'next' | 'prev',
    containerHeight: number,
    wrapLines: boolean
  ) => {
    const activeServerId = stateRef.current.activeServerId
    const ws = stateRef.current.workspaces[activeServerId]
    if (!activeServerId || !ws || !runtimeRef.current) return
    const activeTabId = resolveJobTabId(activeServerId)
    const keyword = ws.find.keyword.trim()
    const runId = ws.job.runId
    if (!keyword || !runId || !activeTabId) return

    const scopeKey = makeScopeKey(activeServerId, activeTabId)
    const currentFind = ws.find.results[scopeKey]
    const fileState = ws.job.fileStates[activeTabId]
    const totalCount = fileState?.count ?? 0

    const fromLine = currentFind?.keyword === keyword && currentFind.lineIndex >= 0
      ? currentFind.lineIndex
      : (direction === 'next' ? -1 : totalCount)
    const fromColumn = currentFind?.keyword === keyword && currentFind.lineIndex >= 0
      ? currentFind.start
      : (direction === 'next' ? -1 : Number.MAX_SAFE_INTEGER)

    dispatch({ type: 'UPDATE_FIND_STATE', serverId: activeServerId, find: { loading: true } })

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

      const latestRunId = stateRef.current.workspaces[activeServerId]?.job.runId
      if (!latestRunId || latestRunId !== result.runId) return

      dispatch({ type: 'SET_FIND_RESULT', serverId: activeServerId, scopeKey, result })

      if (result.total > 0 && result.lineIndex >= 0) {
        beginJump(result.lineIndex, 'center', containerHeight, wrapLines)
      }
    } catch (err: any) {
      showToast(`查找失败: ${err?.message || String(err)}`)
    } finally {
      dispatch({ type: 'UPDATE_FIND_STATE', serverId: activeServerId, find: { loading: false } })
    }
  }, [beginJump, dispatch, invokeSelf, resolveJobTabId, runtimeRef, showToast])

  /** 删除服务器配置 */
  const handleDeleteServer = useCallback(async (srvId: string) => {
    if (!confirm('确定要删除该服务器配置吗？')) return
    handleStopSearchForServer(srvId)
    void invokeSelf('clear_search_results', { serverId: srvId }).catch(() => {})
    clearPeekTrackingForServer(srvId)

    const nextServers = stateRef.current.servers.filter(s => s.id !== srvId)
    dispatch({ type: 'DELETE_SERVER', serverId: srvId })
    await saveAppConfig(nextServers)
  }, [clearPeekTrackingForServer, dispatch, handleStopSearchForServer, invokeSelf, saveAppConfig])

  /** 远程目录浏览 */
  const handleBrowseRemotePath = useCallback(async (path: string, editingServer: ServerConfig): Promise<RemoteBrowseResult> => {
    if (!runtimeRef.current) {
      throw new Error('Runtime 尚未就绪，请稍后重试')
    }
    if (!editingServer.host.trim() || !editingServer.user.trim()) {
      throw new Error('请先填写主机和用户名，再浏览远程目录')
    }
    return invokeSelf<RemoteBrowseResult>('browse_remote_path', {
      server: editingServer,
      path: path.trim()
    })
  }, [invokeSelf, runtimeRef])

  const getPendingJump = useCallback((scopeKey: string): PendingJump | undefined => {
    return pendingJumpRef.current[scopeKey]
  }, [])

  const clearPendingJump = useCallback((scopeKey: string) => {
    delete pendingJumpRef.current[scopeKey]
  }, [])

  return useMemo(() => ({
    invokeSelf,
    loadAppConfig,
    saveAppConfig,
    fetchAvailableFiles,
    peekResultWindow,
    beginJump,
    schedulePeekCurrentWindow,
    handleSearch,
    handleStopSearchForServer,
    handleFindNavigate,
    handleDeleteServer,
    handleBrowseRemotePath,
    getPendingJump,
    clearPendingJump
  }), [
    invokeSelf,
    loadAppConfig,
    saveAppConfig,
    fetchAvailableFiles,
    peekResultWindow,
    beginJump,
    schedulePeekCurrentWindow,
    handleSearch,
    handleStopSearchForServer,
    handleFindNavigate,
    handleDeleteServer,
    handleBrowseRemotePath,
    getPendingJump,
    clearPendingJump
  ])
}
