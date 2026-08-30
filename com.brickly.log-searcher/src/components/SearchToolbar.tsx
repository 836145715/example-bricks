import { AlertTriangle, Palette, Play, Plus, Search, X, XCircle } from 'lucide-react'
import {
  HIGHLIGHT_WORD_SEPARATOR,
  type HighlightKeywordTextMap,
  type StatusHighlightKind
} from '../domain/highlight'
import type { RemoteLogFile } from '../domain/logFiles'
import {
  type FileDateFilter,
  type FileDatePreset
} from '../domain/paths'
import { DEFAULT_TAIL_BYTES, TAIL_BYTE_OPTIONS, type FileListStatus, type FilterConfig, type GrepArgs } from '../types'
import { FileDateFilterControls } from './FileDateFilterControls'
import { FileSelectDropdown } from './FileSelectDropdown'

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
  return (
    <header className="toolbar">
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
              onKeyDown={(event) => event.key === 'Enter' && onSearch()}
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
            onClick={onSearch}
            disabled={!serverId || availableFiles.length === 0}
            type="button"
          >
            <Play size={14} />
            检索
          </button>
        )}

        <button
          className="btn btn-secondary"
          onClick={onToggleConfig}
          disabled={!canEditConnection}
          type="button"
        >
          编辑连接
        </button>
      </div>

      {serverId && (
        <FileDateFilterControls
          filter={dateFilter}
          matchCount={dateMatchedPaths.length}
          availableCount={availableFiles.length}
          onChange={onDateFilterChange}
          onPreset={onDateFilterPreset}
          onClear={onClearDateFilter}
        />
      )}

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
            value={grepArgs.contextC}
            onChange={(event) => onUpdateGrepArgs({ contextC: Math.max(0, parseInt(event.target.value) || 0) })}
          />
        </div>

        <div className="context-input">
          <span title="每个文件只检索末尾这一段。默认 20MB，耗时可预期；整个文件会扫描全量，大日志可能较慢。">
            搜索范围:
          </span>
          <select
            value={grepArgs.tailBytes ?? DEFAULT_TAIL_BYTES}
            onChange={(event) => onUpdateGrepArgs({
              tailBytes: parseInt(event.target.value, 10) || 0,
              maxCount: 0,
              fromTail: false
            })}
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
            {TAIL_BYTE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <button
          className={`inline-tool-btn ${highlightPanelOpen ? 'active' : ''}`}
          onClick={onToggleHighlight}
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
            onClick={onAddFilter}
            disabled={!serverId || isSearching}
            type="button"
          >
            <Plus size={12} />
            添加过滤
          </button>
        </div>
        {extraFilters.length > 0 && (
          <div className="filter-list">
            {extraFilters.map((filter, index) => (
              <div className="filter-item" key={`${serverId}_${index}`}>
                <span className="filter-index">继续过滤 {index + 2}</span>
                <input
                  className="filter-pattern-input"
                  value={filter.pattern}
                  onChange={(event) => onUpdateFilter(index, { pattern: event.target.value })}
                  onKeyDown={(event) => event.key === 'Enter' && onSearch()}
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

      {highlightPanelOpen && (
        <div className="highlight-config-panel">
          <div className="highlight-config-header">
            <div>
              <span className="highlight-config-title">状态高亮词</span>
              <span className="highlight-config-hint">固定使用 {HIGHLIGHT_WORD_SEPARATOR} 分隔，例如 error|exception|错误|失败</span>
            </div>
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
    </header>
  )
}
