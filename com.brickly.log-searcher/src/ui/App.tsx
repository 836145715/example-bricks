import { useState, useReducer, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import type {
  FilterConfig,
  GrepArgs,
  ServerConfig,
  FileDateFilter,
  FileSearchState
} from './types'
import {
  DEFAULT_GREP_ARGS,
  LOG_ROW_HEIGHT,
  WRAPPED_LOG_ROW_ESTIMATE_HEIGHT
} from './types'
import { DEFAULT_FILE_DATE_FILTER, dateFilterPreset, type FileDatePreset } from './domain/paths'
import { workspaceReducer } from './state/workspaceReducer'
import { createInitialWorkspaceState, makeScopeKey } from './state/workspaceHelpers'
import { usePreferences } from './hooks/usePreferences'
import { useServerConfigModal } from './hooks/useServerConfigModal'
import { useSearchController } from './controllers/useSearchController'
import { isDateFilterActive, pathsMatchingDateFilter } from './domain/paths'
import { buildStatusHighlightRules } from './domain/highlight'
import {
  getVisibleResultTabs,
  isEmptyCompletedResultTab,
  resolveActiveResultTab
} from './resultDisplay'

import { TitleBar } from './components/TitleBar'
import { ServerSidebar } from './components/ServerSidebar'
import { SearchToolbar } from './components/SearchToolbar'
import { ResultsPane } from './components/ResultsPane'
import { StatusBar } from './components/StatusBar'
import { ConfigModal } from './components/ConfigModal'

interface SavedScrollPosition {
  startIndex: number
  endIndex: number
}

const DEFAULT_FILE_SEARCH_STATE: FileSearchState = { count: 0, durationMs: 0, active: false, status: 'idle' }

export function App() {
  // 1. 底座进程生命周期 Handle（owned 模式下唯一实例）
  const runtimeRef = useRef<BricklyStartedHandle | null>(null)

  // 2. 状态树与用户偏好
  const [state, dispatch] = useReducer(workspaceReducer, undefined, createInitialWorkspaceState)
  const preferences = usePreferences()

  // 3. 提示与状态条
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('准备就绪')
  const [statusDot, setStatusDot] = useState<'active' | 'warn' | 'error' | ''>('')
  const toastTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setToastMessage(msg)
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 3000)
  }, [])

  const showStatus = useCallback((msg: string, dot: 'active' | 'warn' | 'error' | '' = '') => {
    setStatusMessage(msg)
    setStatusDot(dot)
  }, [])

  // 4. 核心控制器（Mediator 模式）
  const controller = useSearchController({
    state,
    dispatch,
    runtimeRef,
    showToast,
    showStatus
  })

  // 5. 服务器配置弹窗 Hook
  const configModal = useServerConfigModal({
    servers: state.servers,
    onSave: controller.saveAppConfig,
    invokeSelf: controller.invokeSelf
  })

  // 6. 虚拟列表与容器引用
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const consoleContainerRef = useRef<HTMLElement | Window | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const visibleRangeRef = useRef({ startIndex: 0, endIndex: 0 })
  const scrollPositionsRef = useRef<Record<string, SavedScrollPosition>>({})

  // 7. 当前激活的工作区快照
  const activeServerId = state.activeServerId
  const currentWs = activeServerId ? state.workspaces[activeServerId] : undefined
  const activeServer = state.servers.find(s => s.id === activeServerId)
  const visibleResultTabs = currentWs
    ? getVisibleResultTabs(currentWs.job.tabs, currentWs.job.fileStates)
    : []
  const activeTabId = currentWs
    ? resolveActiveResultTab(currentWs.job.tabs, currentWs.job.fileStates, currentWs.job.activeTabId)
    : ''
  const currentScopeKey = activeServerId && activeTabId ? makeScopeKey(activeServerId, activeTabId) : ''
  const activeResultWindow = currentScopeKey ? state.resultWindows[currentScopeKey] : undefined
  const activeFileState: FileSearchState = activeTabId && currentWs
    ? (currentWs.job.fileStates[activeTabId] ?? DEFAULT_FILE_SEARCH_STATE)
    : DEFAULT_FILE_SEARCH_STATE
  const totalResultCount = Math.max(activeResultWindow?.total ?? 0, activeFileState.count)
  const currentLogs = activeResultWindow?.lines || []
  const currentStats = {
    count: activeFileState.count,
    durationMs: activeFileState.durationMs,
    truncated: activeResultWindow?.truncated || false
  }

  // 8. 过滤与高亮派生数据
  const findKeyword = currentWs?.find.keyword || ''
  const findRe = useMemo(() => {
    if (!findKeyword) return null
    try {
      const escaped = findKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(escaped, 'gi')
    } catch {
      return null
    }
  }, [findKeyword])

  const findMatchCount = useMemo(() => {
    if (!currentScopeKey || !findRe) return 0
    return currentLogs.reduce((sum, log) => {
      const matches = log.content.match(findRe)
      return sum + (matches ? matches.length : 0)
    }, 0)
  }, [currentScopeKey, currentLogs, findRe])

  const statusHighlightRules = useMemo(() => {
    return buildStatusHighlightRules(preferences.highlightKeywords)
  }, [preferences.highlightKeywords])

  const emptyCompletedTabCount = useMemo(() => {
    if (!currentWs) return 0
    return currentWs.job.tabs.filter(tab => isEmptyCompletedResultTab(currentWs.job.fileStates[tab])).length
  }, [currentWs])

  const listKey = `${currentWs?.job.runId || ''}::${activeServerId}::${activeTabId}::${preferences.wrapLines ? 'wrap' : 'single'}`
  const visibleLogByIndex = useMemo(() => {
    return new Map(currentLogs.map(log => [log.index, log]))
  }, [currentLogs])

  // 计算当前 Tab/服务器挂载时的起始可视行（保证切回时直接在上次看到的位置开始渲染，不跳回顶部）
  const initialTopMostItemIndex = useMemo(() => {
    if (!currentScopeKey) return undefined
    const saved = scrollPositionsRef.current[currentScopeKey]
    if (!saved || saved.startIndex <= 0) return undefined
    if (totalResultCount <= 0) return undefined
    const targetIndex = Math.min(saved.startIndex, Math.max(0, totalResultCount - 1))
    return { index: targetIndex, align: 'start' as const }
  }, [currentScopeKey, listKey, totalResultCount])

  const getContainerHeight = useCallback(() => {
    if (consoleContainerRef.current && 'clientHeight' in consoleContainerRef.current) {
      return consoleContainerRef.current.clientHeight || 600
    }
    return 600
  }, [])

  // 9. 单次初始化（owned 进程生命周期绑定）
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
        await controller.loadAppConfig()
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
  }, []) // 必须为空依赖，避免重复 start 导致超出 48 个进程上限

  // 10. 连接目标或日志路径变化时重新拉取可用文件列表
  const activeServerListSignature = useMemo(() => {
    const server = state.servers.find(s => s.id === activeServerId)
    if (!server) return ''
    return [
      server.host,
      server.port,
      server.user,
      server.authType,
      server.password ?? '',
      server.keyPath ?? '',
      server.keyText ?? '',
      server.logs.map(log => log.path).join('\n')
    ].join('\u0001')
  }, [state.servers, activeServerId])

  useEffect(() => {
    if (activeServerId && activeServerListSignature) {
      controller.fetchAvailableFiles(activeServerId)
    }
  }, [activeServerId, activeServerListSignature, controller])

  // 11. 当前 Tab 被空结果隐藏时，回落到第一个可见文件
  useEffect(() => {
    if (!activeServerId || !currentWs) return
    const resolvedTabId = resolveActiveResultTab(
      currentWs.job.tabs,
      currentWs.job.fileStates,
      currentWs.job.activeTabId
    )
    if (resolvedTabId && resolvedTabId !== currentWs.job.activeTabId) {
      dispatch({ type: 'SET_ACTIVE_TAB', serverId: activeServerId, tabId: resolvedTabId })
    }
  }, [activeServerId, currentWs])

  // 12. 视口滚动调度与跳转
  const activeResultCountKey = `${currentWs?.job.runId || ''}:${activeFileState.count}`
  useEffect(() => {
    if (!currentScopeKey) return
    const containerHeight = getContainerHeight()
    controller.schedulePeekCurrentWindow(visibleRangeRef.current, containerHeight, preferences.wrapLines)
  }, [activeServerId, activeTabId, currentScopeKey, activeResultCountKey, controller, getContainerHeight, preferences.wrapLines])

  // 13. 执行快速跳转后的滚动定位
  useLayoutEffect(() => {
    if (!currentScopeKey || !activeResultWindow) return
    const pending = controller.getPendingJump(currentScopeKey)
    if (!pending) return
    if (pending.runId && pending.runId !== activeResultWindow.runId) return
    if (activeResultWindow.loading || activeResultWindow.lines.length === 0) return
    if (!currentLogs.some(log => log.index === pending.targetIndex)) return

    virtuosoRef.current?.scrollToIndex({
      index: pending.targetIndex,
      align: pending.align,
      behavior: 'auto'
    })
    controller.clearPendingJump(currentScopeKey)
  }, [
    currentScopeKey,
    currentLogs,
    activeResultWindow?.runId,
    activeResultWindow?.offset,
    activeResultWindow?.loading,
    controller
  ])

  // 14. 滚动回调（实时记忆各 Tab / 服务器最后浏览到的行号与像素高度）
  const handleRangeChanged = useCallback((startIndex: number, endIndex: number) => {
    visibleRangeRef.current = { startIndex, endIndex }
    if (currentScopeKey) {
      scrollPositionsRef.current[currentScopeKey] = {
        startIndex,
        endIndex
      }
    }
    const containerHeight = getContainerHeight()
    controller.schedulePeekCurrentWindow({ startIndex, endIndex }, containerHeight, preferences.wrapLines)
  }, [controller, currentScopeKey, getContainerHeight, preferences.wrapLines])

  const handleScrollerRef = useCallback((node: HTMLElement | Window | null) => {
    consoleContainerRef.current = node
  }, [])

  const handleJumpToTop = useCallback(() => {
    const containerHeight = getContainerHeight()
    controller.beginJump(0, 'start', containerHeight, preferences.wrapLines)
  }, [controller, getContainerHeight, preferences.wrapLines])

  const handleJumpToBottom = useCallback(() => {
    if (totalResultCount <= 0) return
    const containerHeight = getContainerHeight()
    controller.beginJump(totalResultCount - 1, 'end', containerHeight, preferences.wrapLines)
  }, [controller, getContainerHeight, preferences.wrapLines, totalResultCount])

  // 15. 全局快捷键与查找
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (!activeServerId) return
        dispatch({
          type: 'UPDATE_FIND_STATE',
          serverId: activeServerId,
          find: { showBar: true }
        })
        window.setTimeout(() => {
          findInputRef.current?.focus()
          findInputRef.current?.select()
        }, 50)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeServerId])

  const handleFindNavigate = useCallback((direction: 'next' | 'prev') => {
    const containerHeight = getContainerHeight()
    controller.handleFindNavigate(direction, containerHeight, preferences.wrapLines)
  }, [controller, getContainerHeight, preferences.wrapLines])

  const handleCopyLogs = useCallback(() => {
    if (currentLogs.length === 0) return
    const text = currentLogs.map(l => l.content).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制当前视图日志结果')
    })
  }, [currentLogs, showToast])

  // 16. 表单与配置工具栏事件
  const handleDateFilterChange = useCallback((filter: FileDateFilter) => {
    if (!activeServerId) return
    const files = currentWs?.files.availableFiles ?? []
    dispatch({
      type: 'UPDATE_DRAFT',
      serverId: activeServerId,
      draft: isDateFilterActive(filter)
        ? { dateFilter: filter, selectedFiles: pathsMatchingDateFilter(files, filter) }
        : { dateFilter: filter }
    })
  }, [activeServerId, currentWs?.files.availableFiles])

  const handleDateFilterPreset = useCallback((preset: FileDatePreset) => {
    if (!activeServerId) return
    const filter = dateFilterPreset(preset)
    const files = currentWs?.files.availableFiles ?? []
    dispatch({
      type: 'UPDATE_DRAFT',
      serverId: activeServerId,
      draft: {
        dateFilter: filter,
        selectedFiles: pathsMatchingDateFilter(files, filter)
      }
    })
  }, [activeServerId, currentWs?.files.availableFiles])

  const handleClearDateFilter = useCallback(() => {
    if (!activeServerId) return
    dispatch({
      type: 'UPDATE_DRAFT',
      serverId: activeServerId,
      draft: { dateFilter: DEFAULT_FILE_DATE_FILTER }
    })
  }, [activeServerId])

  const handleAddExtraFilter = useCallback(() => {
    if (!activeServerId || !currentWs) return
    const nextFilters = [...currentWs.draft.filters, { pattern: '', ignoreCase: true, invert: false, wordRegexp: false, regexp: false }]
    dispatch({ type: 'UPDATE_DRAFT', serverId: activeServerId, draft: { filters: nextFilters } })
  }, [activeServerId, currentWs])

  const handleUpdateExtraFilter = useCallback((index: number, fields: Partial<FilterConfig>) => {
    if (!activeServerId || !currentWs) return
    const nextFilters = currentWs.draft.filters.map((f, i) => (i === index ? { ...f, ...fields } : f))
    dispatch({ type: 'UPDATE_DRAFT', serverId: activeServerId, draft: { filters: nextFilters } })
  }, [activeServerId, currentWs])

  const handleRemoveExtraFilter = useCallback((index: number) => {
    if (!activeServerId || !currentWs) return
    const nextFilters = currentWs.draft.filters.filter((_, i) => i !== index)
    dispatch({ type: 'UPDATE_DRAFT', serverId: activeServerId, draft: { filters: nextFilters } })
  }, [activeServerId, currentWs])

  const handleUpdateGrepArgs = useCallback((fields: Partial<GrepArgs>) => {
    if (!activeServerId || !currentWs) return
    dispatch({
      type: 'UPDATE_DRAFT',
      serverId: activeServerId,
      draft: { grepArgs: { ...currentWs.draft.grepArgs, ...fields } }
    })
  }, [activeServerId, currentWs])

  // 发起新搜索时重置该服务器各视图的滚动记忆，从首行开始展现
  const handleStartSearch = useCallback(() => {
    if (activeServerId) {
      for (const key of Object.keys(scrollPositionsRef.current)) {
        if (key.startsWith(`${activeServerId}::`)) {
          delete scrollPositionsRef.current[key]
        }
      }
    }
    controller.handleSearch()
  }, [activeServerId, controller])

  return (
    <div className="app-root">
      <TitleBar />
      <main className={`app-shell ${preferences.sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''}`}>
        <ServerSidebar
          servers={state.servers}
          activeServerId={activeServerId}
          collapsed={preferences.sidebarCollapsed}
          onToggleCollapsed={preferences.toggleSidebarCollapsed}
          onAdd={configModal.openCreateModal}
          onSelect={(srv) => dispatch({ type: 'SELECT_SERVER', serverId: srv.id })}
          onEdit={(srv, e) => {
            e.stopPropagation()
            configModal.openEditModal(srv)
          }}
          onClone={(srv, e) => {
            e.stopPropagation()
            const cloned: ServerConfig = {
              ...srv,
              id: 'srv_' + Date.now(),
              name: `${srv.name} (副本)`,
              logs: srv.logs.map(l => ({ ...l }))
            }
            controller.saveAppConfig([...state.servers, cloned])
          }}
          onDelete={(srvId, e) => {
            e.stopPropagation()
            controller.handleDeleteServer(srvId)
          }}
        />

        <section className="main-content">
          <SearchToolbar
            serverId={activeServerId}
            searchPattern={currentWs?.draft.pattern || ''}
            isSearching={currentWs?.job.isSearching || false}
            toastMessage={toastMessage || ''}
            grepArgs={currentWs?.draft.grepArgs || DEFAULT_GREP_ARGS}
            extraFilters={currentWs?.draft.filters || []}
            highlightPanelOpen={preferences.highlightPanelOpen}
            highlightKeywords={preferences.highlightKeywords}
            availableFiles={currentWs?.files.availableFiles || []}
            selectedFiles={currentWs?.draft.selectedFiles || []}
            fileListStatus={currentWs?.files.status || 'idle'}
            dateFilter={currentWs?.draft.dateFilter || DEFAULT_FILE_DATE_FILTER}
            dateMatchedPaths={
              currentWs && isDateFilterActive(currentWs.draft.dateFilter)
                ? pathsMatchingDateFilter(currentWs.files.availableFiles, currentWs.draft.dateFilter)
                : []
            }
            canEditConnection={!!activeServerId}
            onSearchPatternChange={(value) => {
              dispatch({ type: 'UPDATE_DRAFT', serverId: activeServerId, draft: { pattern: value } })
            }}
            onSearch={handleStartSearch}
            onStop={() => controller.handleStopSearchForServer(activeServerId)}
            onToggleConfig={() => {
              if (configModal.configPanelOpen) {
                configModal.closeModal()
              } else if (activeServer) {
                configModal.openEditModal(activeServer)
              }
            }}
            onUpdateGrepArgs={handleUpdateGrepArgs}
            onAddFilter={handleAddExtraFilter}
            onUpdateFilter={handleUpdateExtraFilter}
            onRemoveFilter={handleRemoveExtraFilter}
            onToggleHighlight={preferences.toggleHighlightPanel}
            onResetHighlight={preferences.resetHighlightKeywords}
            onUpdateHighlight={preferences.updateHighlightKeywords}
            onRefreshFiles={() => controller.fetchAvailableFiles(activeServerId)}
            onChangeSelectedFiles={(paths) => {
              dispatch({ type: 'UPDATE_DRAFT', serverId: activeServerId, draft: { selectedFiles: paths } })
            }}
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
              availableFiles={currentWs?.files.availableFiles || []}
              fileStates={currentWs?.job.fileStates || {}}
              currentLogs={currentLogs}
              currentStats={currentStats}
              activeFileState={activeFileState}
              totalResultCount={totalResultCount}
              wrapLines={preferences.wrapLines}
              showFindBar={currentWs?.find.showBar || false}
              findKeyword={findKeyword}
              findLoading={currentWs?.find.loading || false}
              findMatchCount={findMatchCount}
              findResult={currentScopeKey ? currentWs?.find.results[currentScopeKey] ?? null : null}
              findInputRef={findInputRef}
              listKey={listKey}
              logsByIndex={visibleLogByIndex}
              defaultRowHeight={preferences.wrapLines ? WRAPPED_LOG_ROW_ESTIMATE_HEIGHT : LOG_ROW_HEIGHT}
              virtuosoRef={virtuosoRef}
              findRe={findRe}
              statusHighlightRules={statusHighlightRules}
              onSelectTab={(tabId) => dispatch({ type: 'SET_ACTIVE_TAB', serverId: activeServerId, tabId })}
              onToggleWrap={preferences.toggleWrapLines}
              onCopy={handleCopyLogs}
              onFindKeywordChange={(val) => {
                dispatch({ type: 'UPDATE_FIND_STATE', serverId: activeServerId, find: { keyword: val } })
              }}
              onFindNavigate={handleFindNavigate}
              onCloseFind={() => {
                dispatch({
                  type: 'UPDATE_FIND_STATE',
                  serverId: activeServerId,
                  find: { showBar: false, keyword: '', results: {} }
                })
              }}
              onRangeChanged={handleRangeChanged}
              onScrollerRef={handleScrollerRef}
              onJumpTop={handleJumpToTop}
              onJumpBottom={handleJumpToBottom}
              initialTopMostItemIndex={initialTopMostItemIndex}
            />
          </section>

          <StatusBar message={statusMessage} dot={statusDot} />
        </section>
      </main>

      {configModal.configPanelOpen && configModal.editingServer && (
        <ConfigModal
          server={configModal.editingServer}
          isExisting={state.servers.some(s => s.id === configModal.editingServer?.id)}
          connectionTest={configModal.connectionTest}
          onClose={configModal.closeModal}
          onChange={configModal.setEditingServer}
          onAddLogPath={configModal.handleAddLogPath}
          onUpdateLogPath={configModal.handleUpdateLogPath}
          onRemoveLogPath={configModal.handleRemoveLogPath}
          onBrowseRemote={(path) => controller.handleBrowseRemotePath(path, configModal.editingServer!)}
          onTest={configModal.handleTestConnection}
          onSave={configModal.handleSaveForm}
        />
      )}
    </div>
  )
}
