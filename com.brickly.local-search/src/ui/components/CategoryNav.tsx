import clsx from 'clsx'
import { categories } from '../constants'
import type { SearchCategory } from '../types'

export function CategoryNav({
  category,
  categoryStats,
  onSelect
}: {
  category: SearchCategory
  categoryStats: Map<SearchCategory, number>
  onSelect: (id: SearchCategory) => void
}) {
  return (
    <nav className="category-list">
      {categories.map((item) => {
        const Icon = item.icon
        const active = category === item.id
        return (
          <button
            key={item.id}
            className={clsx('category-item', active && 'category-item-active')}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <Icon size={13} style={{ color: active ? undefined : item.color }} />
            <span>{item.label}</span>
            {categoryStats.get(item.id) ? <em>{categoryStats.get(item.id)?.toLocaleString()}</em> : null}
          </button>
        )
      })}
    </nav>
  )
}
