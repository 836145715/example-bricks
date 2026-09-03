import * as Popover from '@radix-ui/react-popover'
import { AlertTriangle, Palette, Play, Plus, Search, SlidersHorizontal, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import {
  HIGHLIGHT_WORD_SEPARATOR,
  type HighlightKeywordTextMap,
  type StatusHighlightKind
} from '../domain/highlight'
import type { RemoteLogFile } from '../domain/logFiles'
import {
  isDateFilterActive,
  type FileDateFilter,
  type FileDatePreset
} from '../domain/paths'
import {
  megabytesFromTailBytes,
  tailBytesFromMegabytes,
  type FileListStatus,
  type FilterConfig,
  type GrepArgs
} from '../types'
import { FileDateFilterControls } from './FileDateFilterControls'
import { FileSelectDropdown } from './FileSelectDropdown'
import { AppTooltip } from './ui/AppTooltip'

function preventDatePickerDismiss(event: { preventDefault: () => void; target: EventTarget | null }) {
  const target = event.target
  if (target instanceof Element && target.closest('input[type="date"]')) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  if (active instanceof HTMLInputElement && active.type === 'date') {
    event.preventDefault()
  }
}

interface SearchToolbarProps {
  serverId: string
  searchPattern: string
  isSearching: boolean
  toastMessage: string
  grepArgs: GrepArgs
  extraFilters: FilterConfig[]
  highlightPanelOpen: boolean
  highlightKeywords: HighlightKeywordTextMap
  availableFiles: RemoteLogFile[]
  selectedFiles: string[]
  fileListStatus: FileListStatus
  dateFilter: FileDateFilter
  dateMatchedPaths: string[]
  canEditConnection: boolean
  onSearchPatternChange: (value: string) => void
  onSearch: () => void
  onStop: () => void
  onToggleConfig: () => void
  onUpdateGrepArgs: (fields: Partial<GrepArgs>) => void
  onAddFilter: () => void
  onUpdateFilter: (index: number, fields: Partial<FilterConfig>) => void
  onRemoveFilter: (index: number) => void
  onToggleHighlight: () => void
  onResetHighlight: () => void
  onUpdateHighlight: (kind: StatusHighlightKind, value: string) => void
  onRefreshFiles: () => void
  onChangeSelectedFiles: (paths: string[]) => void
  onDateFilterChange: (filter: FileDateFilter) => void
  onDateFilterPreset: (kind: FileDatePreset) => void
  onClearDateFilter: () => void
}

function countActiveSearchOptions(
  grepArgs: GrepArgs,
  extraFilters: FilterConfig[],
  dateFilter: FileDateFilter
): number {
  let count = extraFilters.filter(filter => filter.pattern.trim() !== '').length
  if (isDateFilterActive(dateFilter)) count += 1
  if (!grepArgs.ignoreCase) count += 1
  if (grepArgs.invert) count += 1
  if (grepArgs.wordRegexp) count += 1
  if (grepArgs.regexp) count += 1
  if (grepArgs.onlyMatch) count += 1
  if (grepArgs.contextC > 0) count += 1
  if (grepArgs.tailBytes > 0) count += 1
  return count
}

export function SearchToolbar({
  serverId,
  searchPattern,
  isSearching,
  toastMessage,
  grepArgs,
  extraFilters,
  highlightPanelOpen,
  highlightKeywords,
  availableFiles,
  selectedFiles,
  fileListStatus,
  dateFilter,
  dateMatchedPaths,
  canEditConnection,
  onSearchPatternChange,
  onSearch,
  onStop,
  onToggleConfig,
  onUpdateGrepArgs,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  onToggleHighlight,
  onResetHighlight,
  onUpdateHighlight,
  onRefreshFiles,
  onChangeSelectedFiles,
  onDateFilterChange,
  onDateFilterPreset,
  onClearDateFilter
}: SearchToolbarProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const tailMegabytes = megabytesFromTailBytes(grepArgs.tailBytes)
  const activeOptionCount = countActiveSearchOptions(grepArgs, extraFilters, dateFilter)

  const startSearch = () => {
    setOptionsOpen(false)
    onSearch()
  }

  return (
    <header className="toolbar">
      <Popover.Root open={optionsOpen} onOpenChange={setOptionsOpen}>
      <div className="search-row">
        {serverId && (
          <FileSelectDropdown
            serverId={serverId}
            availableFiles={availableFiles}
            selectedFiles={selectedFiles}
            listStatus={fileListStatus}
            dateFilter={dateFilter}
            dateMatchedPaths={dateMatchedPaths}
            onRefresh={onRefreshFiles}
            onChangeSelected={onChangeSelectedFiles}
          />
        )}

        <div style={{ position: 'relative', flex: 1 }}>
          <div className="searchbox">
            <Search size={15} style={{ color: 'var(--text-muted)' }} />
            <input
              value={searchPattern}
              onChange={(event) => onSearchPatternChange(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && startSearch()}
              placeholder="输入检索关键字或正则表达式... (按下回车开始)"
              disabled={isSearching}
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

        {isSearching ? (
          <button className="btn btn-danger" onClick={onStop} type="button">
            <XCircle size={15} />
            停止
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={startSearch}
            disabled={!serverId || availableFiles.length === 0}
            type="button"
          >
            <Play size={14} />
            检索
          </button>
        )}

        {serverId && (
          <AppTooltip label="日期、匹配选项、链式过滤和高亮">
            <Popover.Trigger asChild>
              <button
                className={`btn btn-secondary search-options-btn ${optionsOpen ? 'is-open' : ''}`}
                type="button"
                aria-expanded={optionsOpen}
              >
                <SlidersHorizontal size={14} />
                条件
                {activeOptionCount > 0 && (
                  <span className="search-options-badge">{activeOptionCount}</span>
                )}
              </button>
            </Popover.Trigger>
          </AppTooltip>
        )}

        <AppTooltip label="SSH 主机、认证和日志路径">
          <span className="tooltip-anchor">
            <button
              className="btn btn-secondary"
              onClick={onToggleConfig}
              disabled={!canEditConnection}
              type="button"
            >
              编辑连接
            </button>
          </span>
        </AppTooltip>
      </div>

      {serverId && (
        <Popover.Portal>
        <Popover.Content
          className="search-options-popover"
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          onInteractOutside={preventDatePickerDismiss}
          onPointerDownOutside={preventDatePickerDismiss}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <section className="search-options-section">
            <div className="search-options-title">检索方式</div>
            <div className="params-row">
              <label className="param-checkbox">
                <input
                  type="checkbox"
                  checked={grepArgs.ignoreCase}
                  onChange={(event) => onUpdateGrepArgs({ ignoreCase: event.target.checked })}
                />
                <span>忽略大小写</span>
              </label>
              <label className="param-checkbox">
                <input
                  type="checkbox"
                  checked={grepArgs.invert}
                  onChange={(event) => onUpdateGrepArgs({ invert: event.target.checked })}
                />
                <span>排除匹配行</span>
              </label>
              <label className="param-checkbox">
                <input
                  type="checkbox"
                  checked={grepArgs.wordRegexp}
                  onChange={(event) => onUpdateGrepArgs({ wordRegexp: event.target.checked })}
                />
                <span>只匹配完整词</span>
              </label>
              <label className="param-checkbox">
                <input
                  type="checkbox"
                  checked={grepArgs.regexp}
                  onChange={(event) => onUpdateGrepArgs({ regexp: event.target.checked })}
                />
                <span>使用正则</span>
              </label>
              <label className="param-checkbox">
                <input
                  type="checkbox"
                  checked={grepArgs.onlyMatch}
                  disabled={grepArgs.invert}
                  onChange={(event) => onUpdateGrepArgs({ onlyMatch: event.target.checked })}
                />
                <span>只显示命中片段</span>
              </label>
              <div className="context-input">
                <span>上下文行数:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  placeholder="0"
                  value={grepArgs.contextC > 0 ? grepArgs.contextC : ''}
                  onChange={(event) => onUpdateGrepArgs({
                    contextC: Math.min(50, Math.max(0, parseInt(event.target.value, 10) || 0))
                  })}
                />
              </div>
              <div className="context-input">
                <span title="每个文件从末尾检索的大小。留空或 0 表示整个文件。">
                  末尾:
                </span>
                <input
                  className="tail-lines-input"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="全部"
                  value={tailMegabytes > 0 ? tailMegabytes : ''}
                  onChange={(event) => onUpdateGrepArgs({
                    tailBytes: tailBytesFromMegabytes(parseInt(event.target.value, 10) || 0)
                  })}
                />
                <span>MB</span>
              </div>
            </div>
          </section>

          <section className="search-options-section">
            <div className="search-options-title">文件日期</div>
            <FileDateFilterControls
              filter={dateFilter}
              matchCount={dateMatchedPaths.length}
              availableCount={availableFiles.length}
              onChange={onDateFilterChange}
              onPreset={onDateFilterPreset}
              onClear={onClearDateFilter}
            />
          </section>

          <section className="search-options-section">
            <div className="filter-chain">
              <div className="filter-chain-header">
                <span>链式过滤</span>
                <button
                  className="filter-add-btn"
                  onClick={onAddFilter}
                  disabled={!serverId || isSearching}
                  type="button"
                >
                  <Plus size={12} />
                  添加过滤
                </button>
              </div>
              {extraFilters.length === 0 && (
                <p className="search-options-hint">主关键词命中后再继续缩小结果，等价于 grep 管道。</p>
              )}
              {extraFilters.length > 0 && (
                <div className="filter-list">
                  {extraFilters.map((filter, index) => (
                    <div className="filter-item" key={`${serverId}_${index}`}>
                      <span className="filter-index">继续过滤 {index + 2}</span>
                      <input
                        className="filter-pattern-input"
                        value={filter.pattern}
                        onChange={(event) => onUpdateFilter(index, { pattern: event.target.value })}
                        onKeyDown={(event) => event.key === 'Enter' && startSearch()}
                        placeholder="继续过滤关键词或正则"
                        disabled={isSearching}
                        spellCheck={false}
                      />
                      <label className="param-checkbox compact">
                        <input
                          type="checkbox"
                          checked={filter.ignoreCase}
                          onChange={(event) => onUpdateFilter(index, { ignoreCase: event.target.checked })}
                          disabled={isSearching}
                        />
                        <span>忽略大小写</span>
                      </label>
                      <label className="param-checkbox compact">
                        <input
                          type="checkbox"
                          checked={filter.invert}
                          onChange={(event) => onUpdateFilter(index, { invert: event.target.checked })}
                          disabled={isSearching}
                        />
                        <span>排除</span>
                      </label>
                      <label className="param-checkbox compact">
                        <input
                          type="checkbox"
                          checked={filter.wordRegexp}
                          onChange={(event) => onUpdateFilter(index, { wordRegexp: event.target.checked })}
                          disabled={isSearching}
                        />
                        <span>整词</span>
                      </label>
                      <label className="param-checkbox compact">
                        <input
                          type="checkbox"
                          checked={filter.regexp}
                          onChange={(event) => onUpdateFilter(index, { regexp: event.target.checked })}
                          disabled={isSearching}
                        />
                        <span>正则</span>
                      </label>
                      <button
                        className="filter-remove-btn"
                        onClick={() => onRemoveFilter(index)}
                        disabled={isSearching}
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
          </section>

          <section className="search-options-section">
            <div className="filter-chain-header">
              <span>状态高亮词</span>
              <button
                className={`inline-tool-btn ${highlightPanelOpen ? 'active' : ''}`}
                onClick={onToggleHighlight}
                type="button"
              >
                <Palette size={12} />
                {highlightPanelOpen ? '收起' : '展开'}
              </button>
            </div>
            {highlightPanelOpen && (
              <div className="highlight-config-panel">
                <div className="highlight-config-header">
                  <span className="highlight-config-hint">
                    固定使用 {HIGHLIGHT_WORD_SEPARATOR} 分隔，例如 error|exception|错误|失败
                  </span>
                  <button className="filter-add-btn" onClick={onResetHighlight} type="button">
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
                      onChange={(event) => onUpdateHighlight('status-error', event.target.value)}
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
                      onChange={(event) => onUpdateHighlight('status-warning', event.target.value)}
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
                      onChange={(event) => onUpdateHighlight('status-success', event.target.value)}
                      placeholder="success|ok|成功|完成"
                      spellCheck={false}
                    />
                  </label>
                </div>
              </div>
            )}
          </section>
        </Popover.Content>
        </Popover.Portal>
      )}
      </Popover.Root>
    </header>
  )
}
