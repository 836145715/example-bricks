import { formatLogFileSize, getLogFileName, type RemoteLogFile } from './domain/logFiles'
import { FALLBACK_RESULTS_SCOPE, type FileSearchState, type FileSearchStatus } from './types'

export const getTabLabel = (tabId: string): string => {
  if (tabId === FALLBACK_RESULTS_SCOPE) return '默认路径'
  return getLogFileName(tabId)
}

export const getTabTitle = (tabId: string): string => {
  if (tabId === FALLBACK_RESULTS_SCOPE) return '服务器配置中的启用日志路径'
  return tabId
}

export const getTabFileSize = (files: RemoteLogFile[], tabId: string): string => {
  if (tabId === FALLBACK_RESULTS_SCOPE) return ''
  const file = files.find(candidate => candidate.path === tabId)
  return file?.sizeBytes === undefined ? '' : formatLogFileSize(file.sizeBytes)
}

export const getFileSearchStatusText = (state: FileSearchState): string => {
  if (state.status === 'queued') return '等待检索'
  if (state.status === 'searching') return '正在检索'
  if (state.status === 'error') return `出错: ${state.message || '未知错误'}`
  if (state.status === 'cancelled') return '已取消'
  if (state.status === 'success' || state.status === 'done') {
    return `已完成，匹配 ${state.count} 行${state.durationMs > 0 ? `，耗时 ${state.durationMs}ms` : ''}`
  }
  return '未检索'
}

export const shouldShowResultTab = (state?: FileSearchState): boolean => {
  if (!state) return true
  if (state.active) return true
  if (state.status === 'queued' || state.status === 'searching' || state.status === 'error' || state.status === 'cancelled') {
    return true
  }
  return state.count > 0
}

export const isEmptyCompletedResultTab = (state?: FileSearchState): boolean => {
  if (!state || state.active) return false
  return (state.status === 'success' || state.status === 'done') && state.count <= 0
}

export const getVisibleResultTabs = (
  tabs: string[],
  fileStates: Record<string, FileSearchState>
): string[] => {
  return tabs.filter(tabId => shouldShowResultTab(fileStates[tabId]))
}

/** 当前应展示的结果 Tab：隐藏无匹配的已完成文件，并在当前 Tab 被隐藏时回落到第一个可见 Tab。 */
export const resolveActiveResultTab = (
  tabs: string[],
  fileStates: Record<string, FileSearchState>,
  activeTabId: string
): string => {
  if (tabs.length === 0) return activeTabId
  const visibleTabs = getVisibleResultTabs(tabs, fileStates)
  if (activeTabId && visibleTabs.includes(activeTabId)) return activeTabId
  if (visibleTabs[0]) return visibleTabs[0]
  if (activeTabId && tabs.includes(activeTabId)) return activeTabId
  return tabs[0] ?? ''
}

export const getTabStatusClass = (status: FileSearchStatus): string => {
  if (status === 'queued') return 'queued'
  if (status === 'searching') return 'searching'
  if (status === 'error') return 'error'
  if (status === 'cancelled') return 'warn'
  if (status === 'success' || status === 'done') return 'success'
  return ''
}

export const getTabTitleWithStatus = (
  tabId: string,
  state: FileSearchState,
  fileSize: string
): string => {
  return `${getTabTitle(tabId)}${fileSize ? `\n大小: ${fileSize}` : ''}\n${getFileSearchStatusText(state)}`
}
