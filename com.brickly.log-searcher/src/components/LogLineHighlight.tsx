import { mergeHighlightRanges, type HighlightRule } from '../domain/highlight'
import type { FindResult, ParsedLogLine } from '../types'

interface LogLineHighlightProps {
  log: ParsedLogLine
  findKeyword: string
  findResult: FindResult | null
  findRe: RegExp | null
  statusHighlightRules: HighlightRule[]
}

export function LogLineHighlight({
  log,
  findKeyword,
  findResult,
  findRe,
  statusHighlightRules
}: LogLineHighlightProps) {
  const searchMatches = log.matches ?? []
  const activeFindRange = findResult
    && findResult.keyword === findKeyword.trim()
    && findResult.lineIndex === log.index
    && findResult.start < findResult.end
    ? [findResult.start, findResult.end] as [number, number]
    : null
  const segments = mergeHighlightRanges(log.content, searchMatches, findRe, statusHighlightRules, activeFindRange)

  return (
    <span>
      {segments.map((segment, index) =>
        segment.className
          ? <span key={index} className={segment.className}>{segment.text}</span>
          : <span key={index}>{segment.text}</span>
      )}
    </span>
  )
}
