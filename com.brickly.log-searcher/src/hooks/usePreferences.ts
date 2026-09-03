import { useState } from 'react'
import {
  DEFAULT_STATUS_HIGHLIGHT_KEYWORDS,
  HighlightKeywordTextMap,
  StatusHighlightKind
} from '../domain/highlight'

const LOG_WRAP_PREFERENCE_KEY = 'log_searcher_wrap_lines'
const SIDEBAR_COLLAPSED_KEY = 'log_searcher_sidebar_collapsed'
const HIGHLIGHT_PANEL_KEY = 'log_searcher_highlight_panel_open'
const HIGHLIGHT_KEYWORDS_KEY = 'log_searcher_highlight_keywords'

/**
 * 管理本地存储偏好的自定义 Hook（单一职责）
 */
export function usePreferences() {
  const [wrapLines, setWrapLines] = useState<boolean>(() => {
    return localStorage.getItem(LOG_WRAP_PREFERENCE_KEY) !== 'false'
  })

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  })

  const [highlightPanelOpen, setHighlightPanelOpen] = useState<boolean>(() => {
    return localStorage.getItem(HIGHLIGHT_PANEL_KEY) === 'true'
  })

  const [highlightKeywords, setHighlightKeywords] = useState<HighlightKeywordTextMap>(() => {
    try {
      const stored = localStorage.getItem(HIGHLIGHT_KEYWORDS_KEY)
      if (!stored) return DEFAULT_STATUS_HIGHLIGHT_KEYWORDS
      return { ...DEFAULT_STATUS_HIGHLIGHT_KEYWORDS, ...JSON.parse(stored) }
    } catch {
      return DEFAULT_STATUS_HIGHLIGHT_KEYWORDS
    }
  })

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const toggleHighlightPanel = () => {
    setHighlightPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(HIGHLIGHT_PANEL_KEY, String(next))
      return next
    })
  }

  const toggleWrapLines = () => {
    setWrapLines(prev => {
      const next = !prev
      localStorage.setItem(LOG_WRAP_PREFERENCE_KEY, String(next))
      return next
    })
  }

  const updateHighlightKeywords = (kind: StatusHighlightKind, value: string) => {
    setHighlightKeywords(prev => {
      const next = { ...prev, [kind]: value }
      localStorage.setItem(HIGHLIGHT_KEYWORDS_KEY, JSON.stringify(next))
      return next
    })
  }

  const resetHighlightKeywords = () => {
    setHighlightKeywords(DEFAULT_STATUS_HIGHLIGHT_KEYWORDS)
    localStorage.setItem(HIGHLIGHT_KEYWORDS_KEY, JSON.stringify(DEFAULT_STATUS_HIGHLIGHT_KEYWORDS))
  }

  return {
    wrapLines,
    toggleWrapLines,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    highlightPanelOpen,
    toggleHighlightPanel,
    highlightKeywords,
    updateHighlightKeywords,
    resetHighlightKeywords
  }
}
