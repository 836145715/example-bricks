import type { Ref } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { HighlightRule } from '../domain/highlight'
import type { FindResult, ParsedLogLine } from '../types'
import { LogLineHighlight } from './LogLineHighlight'

interface LogVirtualListProps {
  listKey: string
  totalCount: number
  wrapLines: boolean
  defaultRowHeight: number
  logsByIndex: Map<number, ParsedLogLine>
  virtuosoRef: Ref<VirtuosoHandle>
  findKeyword: string
  findResult: FindResult | null
  findRe: RegExp | null
  statusHighlightRules: HighlightRule[]
  onRangeChanged: (startIndex: number, endIndex: number) => void
  onScrollerRef: (element: HTMLElement | Window | null) => void
  initialTopMostItemIndex?: number | { index: number; align?: 'start' | 'center' | 'end'; offset?: number }
}

export function LogVirtualList({
  listKey,
  totalCount,
  wrapLines,
  defaultRowHeight,
  logsByIndex,
  virtuosoRef,
  findKeyword,
  findResult,
  findRe,
  statusHighlightRules,
  onRangeChanged,
  onScrollerRef,
  initialTopMostItemIndex
}: LogVirtualListProps) {
  return (
    <Virtuoso
      key={listKey}
      ref={virtuosoRef}
      scrollerRef={onScrollerRef}
      style={{ height: '100%', width: '100%' }}
      totalCount={totalCount}
      defaultItemHeight={defaultRowHeight}
      fixedItemHeight={wrapLines ? undefined : defaultRowHeight}
      initialTopMostItemIndex={initialTopMostItemIndex}
      increaseViewportBy={240}
      computeItemKey={(index) => `${listKey}:${index}`}
      rangeChanged={({ startIndex, endIndex }) => onRangeChanged(startIndex, endIndex)}
      itemContent={(index) => {
        const log = logsByIndex.get(index)
        if (!log) {
          return (
            <div
              className={`log-row log-row-placeholder ${wrapLines ? 'log-row-wrap' : ''}`}
              style={{ minHeight: `${defaultRowHeight}px`, height: wrapLines ? undefined : `${defaultRowHeight}px` }}
            >
              <div className="log-content log-content-placeholder" />
            </div>
          )
        }

        return (
          <div
            data-log-index={index}
            className={`log-row ${wrapLines ? 'log-row-wrap' : ''} ${log.error ? 'log-row-error' : ''}`}
          >
            <div className="log-content">
              <LogLineHighlight
                log={log}
                findKeyword={findKeyword}
                findResult={findResult}
                findRe={findRe}
                statusHighlightRules={statusHighlightRules}
              />
            </div>
          </div>
        )
      }}
    />
  )
}
