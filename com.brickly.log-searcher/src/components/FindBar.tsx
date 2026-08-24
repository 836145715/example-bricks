import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { RefObject } from 'react'
import type { FindResult } from '../types'

interface FindBarProps {
  inputRef: RefObject<HTMLInputElement | null>
  keyword: string
  loading: boolean
  matchCount: number
  findResult: FindResult | null
  onKeywordChange: (value: string) => void
  onNavigate: (direction: 'prev' | 'next') => void
  onClose: () => void
}

const getFindCountLabel = (
  keyword: string,
  matchCount: number,
  findResult: FindResult | null
): string => {
  if (!keyword) return ''
  if (findResult?.keyword === keyword.trim()) {
    return findResult.total > 0 ? `${findResult.ordinal}/${findResult.total}` : '0 处'
  }
  return `${matchCount} 处`
}

export function FindBar({
  inputRef,
  keyword,
  loading,
  matchCount,
  findResult,
  onKeywordChange,
  onNavigate,
  onClose
}: FindBarProps) {
  return (
    <div className="find-popover">
      <input
        ref={inputRef}
        className="find-bar-input"
        type="text"
        placeholder="查找"
        value={keyword}
        onChange={(event) => onKeywordChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onNavigate(event.shiftKey ? 'prev' : 'next')
          }
        }}
      />
      <span className="find-bar-count">
        {getFindCountLabel(keyword, matchCount, findResult)}
      </span>
      <button
        className="find-bar-nav"
        onClick={() => onNavigate('prev')}
        disabled={!keyword.trim() || loading}
        title="上一个 (Shift+Enter)"
        type="button"
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="find-bar-nav"
        onClick={() => onNavigate('next')}
        disabled={!keyword.trim() || loading}
        title="下一个 (Enter)"
        type="button"
      >
        <ChevronDown size={14} />
      </button>
      <button
        className="find-bar-close"
        onClick={onClose}
        title="关闭"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  )
}
