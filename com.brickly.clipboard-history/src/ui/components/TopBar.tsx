import clsx from 'clsx'
import {
  Search,
  Star,
  Type,
  Image as ImageIcon,
  FileText,
  ClipboardList,
  X,
  Trash2
} from 'lucide-react'
import React from 'react'
import type { ClipType } from '../types'

export type FilterId = 'all' | ClipType | 'favorite'

export interface FilterOption {
  id: FilterId
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

export const FILTERS: ReadonlyArray<FilterOption> = [
  { id: 'all', label: '全部', icon: ClipboardList },
  { id: 'text', label: '文本', icon: Type },
  { id: 'image', label: '图像', icon: ImageIcon },
  { id: 'file', label: '文件', icon: FileText },
  { id: 'favorite', label: '收藏', icon: Star }
]

interface TopBarProps {
  query: string
  onQueryChange: (query: string) => void
  filter: FilterId
  onFilterChange: (filter: FilterId) => void
  stats: Record<FilterId, number>
  onClearHistory?: () => void
}

/**
 * 顶部检索与分类筛选控制栏组件：
 * 包含关键词搜索框、快捷清空按钮、类型/收藏切换 Chip。
 */
export const TopBar: React.FC<TopBarProps> = ({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  stats,
  onClearHistory
}) => {
  return (
    <div className="topbar">
      {/* 搜索框与按键组合 */}
      <div className="search">
        <Search size={14} className="text-slate-400 shrink-0" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索文本 / 文件路径 / 文件类型..."
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="search-clear-btn text-slate-400 hover:text-slate-200 transition-colors"
            onClick={() => onQueryChange('')}
            title="清空搜索"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* 过滤器导航与批量清空按钮 */}
      <div className="flex items-center gap-2 w-full md:w-auto">
        <nav className="filters" aria-label="类型过滤器">
          {FILTERS.map((entry) => {
            const count = stats[entry.id] ?? 0
            const active = filter === entry.id
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                type="button"
                className={clsx('chip', active && 'chip-active')}
                onClick={() => onFilterChange(entry.id)}
                title={`${entry.label} · ${count} 条`}
              >
                <Icon size={12} className="shrink-0" />
                <span>{entry.label}</span>
                <span className="chip-count">{count}</span>
              </button>
            )
          })}
        </nav>

        {onClearHistory && (
          <button
            type="button"
            className="chip chip-danger shrink-0 ml-auto md:ml-0"
            onClick={onClearHistory}
            title="清空非收藏历史"
          >
            <Trash2 size={12} className="shrink-0" />
            <span className="hidden sm:inline">清空</span>
          </button>
        )}
      </div>
    </div>
  )
}
