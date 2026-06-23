export type HighlightRange = [number, number]

export interface HighlightSegment {
  text: string
  className: string
}

export type HighlightKind = 'status-success' | 'status-error' | 'status-warning' | 'search' | 'find' | 'active-find'
export type StatusHighlightKind = Exclude<HighlightKind, 'search' | 'find' | 'active-find'>
export type HighlightKeywordTextMap = Record<StatusHighlightKind, string>

export interface HighlightRule {
  kind: StatusHighlightKind
  words: string[]
}

interface HighlightEvent {
  pos: number
  kind: HighlightKind
  enter: boolean
}

export const HIGHLIGHT_WORD_SEPARATOR = '|'

export const DEFAULT_STATUS_HIGHLIGHT_KEYWORDS: HighlightKeywordTextMap = {
  'status-success': 'success|succeed|successful|ok|done|ready|passed|created|updated|completed|healthy|started|connected|200|201|204|成功|正常|完成|通过|已启动|已连接|就绪|健康',
  'status-error': 'error|exception|panic|fatal|fail|failed|failure|timeout|denied|refused|unauthorized|forbidden|crash|invalid|broken|500|502|503|504|错误|异常|失败|报错|超时|拒绝|未授权|崩溃|无效|不可用',
  'status-warning': 'warning|warn|deprecated|retry|slow|blocked|pending|429|警告|告警|注意|重试|过慢|阻塞|等待|限流'
}

export const escapeRegExp = (value: string): string => {
  return value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
}

export const parseHighlightKeywordText = (value: string): string[] => {
  const trimmedValue = value.trim()
  const normalizedValue = trimmedValue.startsWith('(') && trimmedValue.endsWith(')')
    ? trimmedValue.slice(1, -1)
    : trimmedValue

  const seen = new Set<string>()
  const words: string[] = []

  for (const rawWord of normalizedValue.split(HIGHLIGHT_WORD_SEPARATOR)) {
    const word = rawWord.trim()
    const dedupeKey = word.toLowerCase()
    if (!word || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    words.push(word)
  }

  return words
}

export const buildStatusHighlightRules = (
  keywordTextMap: HighlightKeywordTextMap = DEFAULT_STATUS_HIGHLIGHT_KEYWORDS
): HighlightRule[] => {
  return (['status-success', 'status-error', 'status-warning'] as StatusHighlightKind[]).map(kind => ({
    kind,
    words: parseHighlightKeywordText(keywordTextMap[kind] ?? '')
  }))
}

export const STATUS_HIGHLIGHT_RULES: HighlightRule[] = buildStatusHighlightRules()

const highlightKindClassMap: Record<HighlightKind, string> = {
  'status-success': 'log-status-success',
  'status-error': 'log-status-error',
  'status-warning': 'log-status-warning',
  search: 'log-highlight',
  find: 'log-find-highlight',
  'active-find': 'log-find-highlight-active'
}

const highlightKindPriority: HighlightKind[] = [
  'status-success',
  'status-error',
  'status-warning',
  'search',
  'find',
  'active-find'
]

const createKeywordRegExp = (words: string[]): RegExp => {
  return new RegExp([...words].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'gi')
}

const pushRegexEvents = (events: HighlightEvent[], content: string, re: RegExp, kind: HighlightKind): number => {
  const localRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let count = 0
  let match: RegExpExecArray | null

  while ((match = localRe.exec(content)) !== null) {
    events.push({ pos: match.index, kind, enter: true })
    events.push({ pos: match.index + match[0].length, kind, enter: false })
    count++
    if (match.index === localRe.lastIndex) localRe.lastIndex++
  }

  return count
}

export const countFindMatches = (content: string, findRe: RegExp | null): number => {
  if (!findRe) return 0
  const events: HighlightEvent[] = []
  return pushRegexEvents(events, content, findRe, 'find')
}

export const mergeHighlightRanges = (
  content: string,
  searchMatches: HighlightRange[],
  findRe: RegExp | null,
  statusRules: HighlightRule[] = STATUS_HIGHLIGHT_RULES,
  activeFindRange?: HighlightRange | null
): HighlightSegment[] => {
  const events: HighlightEvent[] = []

  for (const [start, end] of searchMatches) {
    if (start < end && start >= 0 && end <= content.length) {
      events.push({ pos: start, kind: 'search', enter: true })
      events.push({ pos: end, kind: 'search', enter: false })
    }
  }

  if (findRe) {
    pushRegexEvents(events, content, findRe, 'find')
  }

  if (activeFindRange) {
    const [start, end] = activeFindRange
    if (start < end && start >= 0 && end <= content.length) {
      events.push({ pos: start, kind: 'active-find', enter: true })
      events.push({ pos: end, kind: 'active-find', enter: false })
    }
  }

  for (const rule of statusRules) {
    if (rule.words.length > 0) {
      pushRegexEvents(events, content, createKeywordRegExp(rule.words), rule.kind)
    }
  }

  events.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    if (a.enter !== b.enter) return a.enter ? 1 : -1
    return highlightKindPriority.indexOf(a.kind) - highlightKindPriority.indexOf(b.kind)
  })

  let lastPos = 0
  const activeDepth = new Map<HighlightKind, number>()
  const segments: HighlightSegment[] = []

  for (const event of events) {
    if (event.pos > lastPos) {
      const className = highlightKindPriority
        .filter(kind => (activeDepth.get(kind) ?? 0) > 0)
        .map(kind => highlightKindClassMap[kind])
        .join(' ')
      segments.push({ text: content.slice(lastPos, event.pos), className })
    }

    const currentDepth = activeDepth.get(event.kind) ?? 0
    activeDepth.set(event.kind, Math.max(0, currentDepth + (event.enter ? 1 : -1)))
    lastPos = event.pos
  }

  if (lastPos < content.length) {
    segments.push({ text: content.slice(lastPos), className: '' })
  }

  return segments
}
