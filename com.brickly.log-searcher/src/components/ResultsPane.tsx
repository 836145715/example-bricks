import { AlertTriangle, ChevronDown, ChevronUp, Copy, Search, TextWrap, XCircle } from 'lucide-react'
import type { Ref, RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { HighlightRule } from '../domain/highlight'
import type { RemoteLogFile } from '../domain/logFiles'
import {
  getTabFileSize,
  getTabLabel,
  getTabStatusClass,
  getTabTitle,
  getTabTitleWithStatus
} from '../resultDisplay'
import type {
  FileSearchState,
  FindResult,
  GrepArgs,
  ParsedLogLine,
  ServerConfig
} from '../types'
import { FindBar } from './FindBar'
import { LogVirtualList } from './LogVirtualList'

interface ResultsPaneProps {
  activeServer?: ServerConfig
  activeServerId: string
  activeTabId: string
  visibleResultTabs: string[]
  emptyCompletedTabCount: number
  availableFiles: RemoteLogFile[]
  fileStates: Record<string, FileSearchState>
  currentLogs: ParsedLogLine[]
  currentStats: { count: number; durationMs: number; truncated?: boolean }
  activeFileState: FileSearchState
  totalResultCount: number
  wrapLines: boolean
  showFindBar: boolean
  findKeyword: string
  findLoading: boolean
  findMatchCount: number
  findResult: FindResult | null
  findInputRef: RefObject<HTMLInputElement | null>
  listKey: string
  logsByIndex: Map<number, ParsedLogLine>
  defaultRowHeight: number
  virtuosoRef: Ref<VirtuosoHandle>
  committedPattern?: string
  committedArgs?: GrepArgs
  findRe: RegExp | null
  statusHighlightRules: HighlightRule[]
  onSelectTab: (tabId: string) => void
  onToggleWrap: () => void
  onCopy: () => void
  onFindKeywordChange: (value: string) => void
  onFindNavigate: (direction: 'prev' | 'next') => void
  onCloseFind: () => void
  onRangeChanged: (startIndex: number, endIndex: number) => void
  onScrollerRef: (element: HTMLElement | Window | null) => void
  onJumpTop: () => void
  onJumpBottom: () => void
}

function EmptyResults({
  fileState,
  tabId
}: {
  fileState: FileSearchState
  tabId: string
}) {
  if (fileState.status === 'error') {
    return (
      <div className="empty-state empty-state-error">
        <AlertTriangle size={32} />
        <h3>文件检索失败</h3>
        <p className="empty-state-message">{fileState.message || '未知错误'}</p>
        <p className="empty-state-detail">{getTabTitle(tabId)}</p>
      </div>
    )
  }
  if (fileState.status === 'queued') {
    return (
      <div className="empty-state">
        <div className="status-dot warn" style={{ width: '12px', height: '12px', marginBottom: '8px' }} />
        <h3>等待检索...</h3>
        <p style={{ fontSize: '12px' }}>前面的日志文件完成后，会自动检索当前文件。</p>
      </div>
    )
  }
  if (fileState.status === 'cancelled') {
    return (
      <div className="empty-state">
        <XCircle size={32} style={{ opacity: 0.55 }} />
        <h3>检索已取消</h3>
        <p style={{ fontSize: '12px' }}>当前文件没有继续输出日志结果。</p>
      </div>
    )
  }
  if (!fileState.active) {
    return (
      <div className="empty-state">
        <Search size={32} style={{ opacity: 0.4 }} />
        <h3>暂无检索结果</h3>
        <p style={{ fontSize: '12px' }}>请输入搜索文本，或确认是否启用了日志文件路径。</p>
      </div>
    )
  }
  return (
    <div className="empty-state">
      <div className="status-dot active" style={{ width: '12px', height: '12px', marginBottom: '8px' }} />
      <h3>流式连接检索中...</h3>
      <p style={{ fontSize: '12px' }}>Go 后端正在扫描日志中，稍后结果会自动输出在此处。</p>
    </div>
  )
}

export function ResultsPane({
  activeServer,
  activeServerId,
  activeTabId,
  visibleResultTabs,
  emptyCompletedTabCount,
  availableFiles,
  fileStates,
  currentLogs,
  currentStats,
  activeFileState,
  totalResultCount,
  wrapLines,
  showFindBar,
  findKeyword,
  findLoading,
  findMatchCount,
  findResult,
  findInputRef,
  listKey,
  logsByIndex,
  defaultRowHeight,
  virtuosoRef,
  committedPattern,
  committedArgs,
  findRe,
  statusHighlightRules,
  onSelectTab,
  onToggleWrap,
  onCopy,
  onFindKeywordChange,
  onFindNavigate,
  onCloseFind,
  onRangeChanged,
  onScrollerRef,
  onJumpTop,
  onJumpBottom
}: ResultsPaneProps) {
  return (
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
              {currentStats.truncated && '，已达 5 万行上限，已停止该文件检索'}
              {emptyCompletedTabCount > 0 && `，${emptyCompletedTabCount} 个文件无匹配`}
            </span>
          )}
          {currentStats.count <= 0 && emptyCompletedTabCount > 0 && (
            <span>{emptyCompletedTabCount} 个文件无匹配</span>
          )}
          <button
            className={`sidebar-action-btn results-mode-btn ${wrapLines ? 'active' : ''}`}
            onClick={onToggleWrap}
            title={wrapLines ? '当前为自动换行模式，点击切换到单行极速模式' : '当前为单行极速模式，点击切换到自动换行'}
            type="button"
            aria-pressed={wrapLines}
          >
            <TextWrap size={12} />
            <span>{wrapLines ? '换行' : '单行'}</span>
          </button>
          {currentLogs.length > 0 && (
            <button className="sidebar-action-btn" onClick={onCopy} title="复制当前已加载视图" type="button">
              <Copy size={12} />
            </button>
          )}
        </div>
      </div>

      {visibleResultTabs.length > 1 && (
        <div className="result-tabs" role="tablist" aria-label="日志文件结果视图">
          {visibleResultTabs.map(tabId => {
            const tabStats = fileStates[tabId] ?? {
              count: 0,
              durationMs: 0,
              active: false,
              status: 'idle' as const
            }
            const fileSize = getTabFileSize(availableFiles, tabId)

            return (
              <button
                key={tabId}
                className={`result-tab ${activeTabId === tabId ? 'active' : ''}`}
                onClick={() => onSelectTab(tabId)}
                title={getTabTitleWithStatus(tabId, tabStats, fileSize)}
                role="tab"
                aria-selected={activeTabId === tabId}
                type="button"
              >
                <span className={`result-tab-dot ${getTabStatusClass(tabStats.status)}`} />
                <span className="result-tab-label">{getTabLabel(tabId)}</span>
                {fileSize && <span className="result-tab-size">{fileSize}</span>}
                {tabStats.count > 0 && <span className="result-tab-count">{tabStats.count}</span>}
              </button>
            )
          })}
        </div>
      )}

      {showFindBar && activeServerId && (
        <FindBar
          inputRef={findInputRef}
          keyword={findKeyword}
          loading={findLoading}
          matchCount={findMatchCount}
          findResult={findResult}
          onKeywordChange={onFindKeywordChange}
          onNavigate={onFindNavigate}
          onClose={onCloseFind}
        />
      )}

      <div className={`results-console ${showFindBar ? 'results-console-with-find' : ''}`}>
        {totalResultCount === 0 ? (
          <EmptyResults fileState={activeFileState} tabId={activeTabId} />
        ) : (
          <>
            {activeFileState.status === 'error' && (
              <div className="result-error-banner">
                <AlertTriangle size={14} />
                <span>当前文件检索失败: {activeFileState.message || '未知错误'}</span>
              </div>
            )}
            <div className="results-console-list">
              <LogVirtualList
                listKey={listKey}
                totalCount={totalResultCount}
                wrapLines={wrapLines}
                defaultRowHeight={defaultRowHeight}
                logsByIndex={logsByIndex}
                virtuosoRef={virtuosoRef}
                committedPattern={committedPattern}
                committedArgs={committedArgs}
                findKeyword={findKeyword}
                findResult={findResult}
                findRe={findRe}
                statusHighlightRules={statusHighlightRules}
                onRangeChanged={onRangeChanged}
                onScrollerRef={onScrollerRef}
              />
            </div>
          </>
        )}
      </div>

      {totalResultCount > 0 && (
        <div className="results-jump-controls" aria-label="日志结果快速滚动">
          <button
            className="results-jump-btn"
            onClick={onJumpTop}
            title="到顶部"
            type="button"
          >
            <ChevronUp size={15} />
          </button>
          <button
            className="results-jump-btn"
            onClick={onJumpBottom}
            title="到底部"
            type="button"
          >
            <ChevronDown size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
