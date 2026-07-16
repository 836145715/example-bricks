import { useCallback, useEffect, useState } from 'react'
import { HISTORY_LIMIT, loadHistory, makeHistoryId, saveHistory } from '../lib/history'
import type { HistoryItem } from '../types'

export function useHistory() {
  const [items, setItems] = useState<HistoryItem[]>(() => loadHistory())

  useEffect(() => {
    saveHistory(items)
  }, [items])

  const push = useCallback((partial: Omit<HistoryItem, 'id' | 'createdAt'>) => {
    const item: HistoryItem = {
      ...partial,
      id: makeHistoryId(),
      createdAt: Date.now(),
    }
    setItems((prev) => [item, ...prev].slice(0, HISTORY_LIMIT))
    return item
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const clear = useCallback(() => {
    setItems([])
  }, [])

  return { items, push, remove, clear }
}
