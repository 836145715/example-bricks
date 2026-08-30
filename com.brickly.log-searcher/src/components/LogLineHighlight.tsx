import { escapeRegExp, mergeHighlightRanges, type HighlightRule } from '../domain/highlight'
import type { FindResult, GrepArgs, ParsedLogLine } from '../types'

interface LogLineHighlightProps {
  log: ParsedLogLine
  committedPattern?: string
  committedArgs?: GrepArgs
  findKeyword: string
  findResult: FindResult | null
  findRe: RegExp | null
  statusHighlightRules: HighlightRule[]
}

const getSearchMatchesFromLegacyLine = (
  log: ParsedLogLine,
  committedPattern: string,
  committedArgs: GrepArgs
): Array<[number, number]> => {
  try {
    let rePattern = committedArgs.regexp ? committedPattern : escapeRegExp(committedPattern)
    if (committedArgs.wordRegexp) {
      rePattern = '\\b' + rePattern + '\\b'
    }
    const flags = committedArgs.ignoreCase ? 'gi' : 'g'
    const re = new RegExp(`(${rePattern})`, flags)
    const parts = log.content.split(re)
    let pos = 0
    const matches: Array<[number, number]> = []

    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        matches.push([pos, pos + parts[i].length])
      }
      pos += parts[i].length
    }

    return matches
  } catch {
    return []
  }
}

export function LogLineHighlight({
  log,
  committedPattern,
  committedArgs,
  findKeyword,
  findResult,
  findRe,
  statusHighlightRules
}: LogLineHighlightProps) {
  let searchMatches: Array<[number, number]> = []
  if (log.matches !== undefined) {
    searchMatches = log.matches
  } else if (committedPattern && committedArgs && !committedArgs.invert) {
    searchMatches = getSearchMatchesFromLegacyLine(log, committedPattern, committedArgs)
  }

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
