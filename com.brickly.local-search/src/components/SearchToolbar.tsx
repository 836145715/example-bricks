import { Loader2, RefreshCw, Search } from 'lucide-react'
import { sortOptions } from '../constants'
import type { SearchSort } from '../types'

export function SearchToolbar({
  query,
  sort,
  loading,
  indexReady,
  onQueryChange,
  onSortChange,
  onRefresh
}: {
  query: string
  sort: SearchSort
  loading: boolean
  indexReady: boolean
  onQueryChange: (value: string) => void
  onSortChange: (value: SearchSort) => void
  onRefresh: () => void
}) {
  return (
    <header className="toolbar">
      <div className="searchbox">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="输入文件名、路径或 Everything 查询语法 (Esc 清空)"
          spellCheck={false}
          autoFocus
          disabled={!indexReady}
        />
      </div>
      <select
        value={sort}
        onChange={(event) => onSortChange(event.target.value as SearchSort)}
        disabled={!indexReady}
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="icon-btn" onClick={onRefresh} title="刷新结果" type="button" disabled={!indexReady}>
        {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
      </button>
    </header>
  )
}
