import { Search } from 'lucide-react'
import { joinPath } from '../lib/format'
import type { HealthReason, HealthStatus, SearchItem, SearchResult } from '../types'
import { IndexLoading } from './IndexLoading'
import { ResultRow } from './ResultRow'
import { SetupPanel } from './SetupPanel'

export function ResultsPane({
  health,
  reason,
  indexReady,
  starting,
  loading,
  result,
  query,
  selectedPath,
  page,
  totalPages,
  canPrev,
  canNext,
  getIcon,
  onDownload,
  onStart,
  onRecheck,
  onSelect,
  onOpen,
  onShowInFolder,
  onCopyPath,
  onPage
}: {
  health: HealthStatus | null
  reason: HealthReason | null
  indexReady: boolean
  starting: boolean
  loading: boolean
  result: SearchResult
  query: string
  selectedPath: string
  page: number
  totalPages: number
  canPrev: boolean
  canNext: boolean
  getIcon?: (path: string) => Promise<string>
  onDownload: () => void
  onStart: () => void
  onRecheck: () => void
  onSelect: (item: SearchItem) => void
  onOpen: (path: string) => void
  onShowInFolder: (path: string) => void
  onCopyPath: (path: string) => void
  onPage: (page: number) => void
}) {
  return (
    <section className="results-pane">
      {!health || reason === 'indexing' || reason === 'not_running' || reason === 'ipc_unavailable' ? (
        <IndexLoading checking={!health} starting={reason === 'not_running' || reason === 'ipc_unavailable'} />
      ) : !indexReady ? (
        <SetupPanel health={health} starting={starting} onDownload={onDownload} onStart={onStart} onRecheck={onRecheck} />
      ) : result.items.length === 0 ? (
        <div className="empty">
          <Search size={26} />
          <h2>{loading ? '搜索中' : '暂无结果'}</h2>
          <p>{loading ? '正在读取 Everything 索引' : '换个关键词或分类再试一次'}</p>
        </div>
      ) : (
        <ul className="result-list">
          {result.items.map((item) => {
            const itemPath = item.fullPath || joinPath(item)
            return (
              <ResultRow
                key={`${itemPath}:${item.dateModified}`}
                item={item}
                active={selectedPath === itemPath}
                query={query}
                onSelect={() => onSelect(item)}
                onOpen={() => onOpen(itemPath)}
                onShowInFolder={() => onShowInFolder(itemPath)}
                onCopyPath={() => onCopyPath(itemPath)}
                getIcon={getIcon}
              />
            )
          })}
        </ul>
      )}
      <footer className="pager">
        <span className="pager-count">
          {result.categoryLabel || '全部'}
          <strong>{indexReady ? `${result.total.toLocaleString()} 条` : '—'}</strong>
        </span>
        <div className="pager-nav">
          <button type="button" disabled={!indexReady || !canPrev || loading} onClick={() => onPage(page - 1)}>
            上一页
          </button>
          <span>
            {indexReady ? page + 1 : 1} / {indexReady ? totalPages : 1}
          </span>
          <button type="button" disabled={!indexReady || !canNext || loading} onClick={() => onPage(page + 1)}>
            下一页
          </button>
        </div>
      </footer>
    </section>
  )
}
