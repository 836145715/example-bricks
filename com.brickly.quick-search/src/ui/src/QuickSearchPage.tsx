import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent, RefObject } from 'react'
import {
  activate as requestActivate,
  channelReady,
  endDrag,
  hideWindow,
  onShown,
  onSnapshot,
  runAction as requestRunAction,
  search as requestSearch,
  startDrag
} from './brickly'
import type { ActivationResult, BadgeTone, SearchResult, SearchSnapshot } from './types'
import { cn } from './cn'
import { BrickFallbackIcon } from './BrickFallbackIcon'

type SearchState = 'idle' | 'loading' | 'error'
type ActionMenuState = { resultId: string; x: number; y: number }
type DisplayRow =
  | { type: 'group'; id: string; label: string; count: number }
  | { type: 'result'; result: SearchResult; resultIndex: number }

const EMPTY_RESULTS: SearchResult[] = []
const WINDOW_WIDTH = 720
const HORIZONTAL_PADDING = 12
const INPUT_LEFT = HORIZONTAL_PADDING
const DRAG_MASK_RIGHT_SAFE_AREA = 12
const ROW_ID_PREFIX = 'quick-search-result'
const ACTION_MENU_WIDTH = 208
const ACTION_MENU_MAX_HEIGHT = 240

export function QuickSearchPage(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>(EMPTY_RESULTS)
  const [activeIndex, setActiveIndex] = useState(0)
  const [state, setState] = useState<SearchState>('idle')
  const [message, setMessage] = useState('')
  const [providerStates, setProviderStates] = useState<SearchSnapshot['providerStates']>([])
  const [complete, setComplete] = useState(true)
  const [activation, setActivation] = useState<ActivationResult | undefined>()
  const [actionMenu, setActionMenu] = useState<ActionMenuState | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)
  const queryRef = useRef(query)
  const inputWidth = useInputMeasuredWidth(inputRef, query, '搜索工具、应用或命令')

  const applySnapshot = useCallback((snapshot: SearchSnapshot): void => {
    setResults(snapshot.results)
    setProviderStates(snapshot.providerStates)
    setComplete(snapshot.complete)
    setActiveIndex((current) => Math.min(current, Math.max(0, snapshot.results.length - 1)))
    if (snapshot.error) {
      setState('error')
      setMessage(snapshot.error)
      return
    }
    setState(snapshot.complete ? 'idle' : 'loading')
    setMessage('')
  }, [])

  const focusInput = useCallback((): void => {
    const focusNow = (): void => {
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.select()
    }
    focusNow()
    window.requestAnimationFrame(focusNow)
    window.setTimeout(focusNow, 50)
  }, [])

  const search = useCallback((nextQuery: string): void => {
    if (!channelReady()) {
      setState('error')
      setMessage('搜索通道未就绪（window.brickly 未注入）')
      return
    }
    setState('loading')
    setComplete(false)
    requestSearch(nextQuery)
  }, [])

  useEffect(() => {
    queryRef.current = query
  }, [query])

  // 透明窗口：根容器保持透明，卡片自己带背景。
  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background
    const previousBodyBackground = document.body.style.background
    const root = document.getElementById('root')
    const previousRootBackground = root?.style.background
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    if (root) root.style.background = 'transparent'
    return () => {
      document.documentElement.style.background = previousHtmlBackground
      document.body.style.background = previousBodyBackground
      if (root && previousRootBackground !== undefined)
        root.style.background = previousRootBackground
    }
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => search(query), 80)
    return () => window.clearTimeout(handle)
  }, [query, search])

  // 每次浮窗显示：复位激活态、聚焦输入、按当前 query 重新拉一轮。
  useEffect(() => {
    const focusSearch = (): void => {
      setActivation(undefined)
      focusInput()
      search(queryRef.current)
    }
    focusSearch()
    const unsubscribe = onShown(focusSearch)
    window.addEventListener('focus', focusSearch)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', focusSearch)
    }
  }, [focusInput, search])

  useEffect(() => onSnapshot(applySnapshot), [applySnapshot])

  const activeResult = results[activeIndex]
  const hasResults = results.length > 0
  const displayRows = useMemo(() => buildDisplayRows(results), [results])
  const activeProviderLabel = activeResult?.providerLabel

  useEffect(() => {
    if (!activeResult) return
    document
      .getElementById(resultDomId(activeResult.id))
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeResult])

  const move = (offset: number): void => {
    if (!hasResults) return
    setActionMenu(undefined)
    setActiveIndex((current) => (current + offset + results.length) % results.length)
  }

  const hide = (): void => {
    hideWindow()
  }

  const activate = async (target: SearchResult | undefined): Promise<void> => {
    if (!target || target.disabled) return
    setActionMenu(undefined)
    setState('loading')
    setMessage('')
    try {
      const result = await requestActivate(target.id)
      setActivation(result)
      setQuery('')
      setResults(EMPTY_RESULTS)
      setProviderStates([])
      setComplete(true)
      setState('idle')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const openActionMenu = (
    target: SearchResult | undefined,
    point?: { x: number; y: number }
  ): void => {
    if (!target || target.disabled || !target.actions?.length) return
    const anchor = point ?? menuAnchorForResult(target.id)
    setActionMenu({ resultId: target.id, x: anchor.x, y: anchor.y })
  }

  const runAction = async (target: SearchResult, actionId: string): Promise<void> => {
    setActionMenu(undefined)
    setState('loading')
    setMessage('')
    try {
      const result = await requestRunAction(target.id, actionId)
      setActivation(result)
      setQuery('')
      setResults(EMPTY_RESULTS)
      setProviderStates([])
      setComplete(true)
      setState('idle')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (actionMenu) {
        setActionMenu(undefined)
        return
      }
      hide()
      return
    }
    const direction = getNavigationDirection(event)
    if (direction) {
      event.preventDefault()
      move(direction)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.altKey) {
        openActionMenu(activeResult)
        return
      }
      void activate(activeResult)
    }
  }

  const summary = useMemo(() => {
    if (state === 'loading') return '正在搜索'
    if (state === 'error') return message || '搜索异常'
    if (activation?.message) return activation.message
    if (query.trim()) {
      const runningCount = providerStates.filter((item) => item.status === 'running').length
      if (!complete && runningCount > 0)
        return `${results.length} 个结果 · 正在搜索 ${runningCount} 个来源`
      return `${results.length} 个结果`
    }
    return ''
  }, [activation?.message, complete, message, providerStates, query, results.length, state])

  const dragMaskLeft = Math.min(
    Math.round(INPUT_LEFT + inputWidth),
    WINDOW_WIDTH - DRAG_MASK_RIGHT_SAFE_AREA
  )
  const dragMaskWidth = Math.max(0, WINDOW_WIDTH - dragMaskLeft - DRAG_MASK_RIGHT_SAFE_AREA)

  return (
    <div className="dark h-full overflow-hidden bg-transparent text-foreground">
      <main
        className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
        onClick={() => setActionMenu(undefined)}
      >
        <header className="relative flex h-[66px] shrink-0 items-center px-3">
          {activeProviderLabel && (
            <div className="pointer-events-none absolute top-1.5 left-3 z-10 text-[11px] font-medium text-muted-foreground">
              {activeProviderLabel}
            </div>
          )}
          <input
            ref={inputRef}
            value={query}
            autoFocus
            role="combobox"
            aria-expanded={hasResults}
            aria-controls="quick-search-results"
            aria-activedescendant={activeResult ? resultDomId(activeResult.id) : undefined}
            onChange={(event) => {
              setActivation(undefined)
              setQuery(event.target.value)
            }}
            onKeyDown={onKeyDown}
            placeholder="搜索工具、应用或命令"
            spellCheck={false}
            className="relative z-10 h-full min-w-0 flex-1 bg-transparent pt-2 text-2xl font-normal tracking-normal text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {summary && (
            <div className="pointer-events-none absolute right-4 bottom-1 text-[11px] text-muted-foreground">
              {summary}
            </div>
          )}
          <DragMask
            left={dragMaskLeft}
            width={dragMaskWidth}
            onClick={() => inputRef.current?.focus()}
          />
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {state !== 'loading' && !hasResults && (
            <div className="grid h-full place-items-center text-center">
              <div className="text-sm text-muted-foreground">
                {query.trim()
                  ? '没有匹配项'
                  : activation?.resultPreview || activation?.message || ''}
              </div>
            </div>
          )}

          {hasResults && (
            <div id="quick-search-results" role="listbox" className="grid gap-0.5">
              {displayRows.map((row) =>
                row.type === 'group' ? (
                  <SearchResultGroupHeader key={row.id} label={row.label} count={row.count} />
                ) : (
                  <SearchResultRow
                    key={row.result.id}
                    result={row.result}
                    active={row.resultIndex === activeIndex}
                    onMouseEnter={() => setActiveIndex(row.resultIndex)}
                    onClick={() => void activate(row.result)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setActiveIndex(row.resultIndex)
                      openActionMenu(row.result, { x: event.clientX, y: event.clientY })
                    }}
                  />
                )
              )}
            </div>
          )}
        </section>

        {actionMenu && (
          <QuickSearchActionMenu
            result={results.find((item) => item.id === actionMenu.resultId)}
            x={actionMenu.x}
            y={actionMenu.y}
            onClose={() => setActionMenu(undefined)}
            onRunAction={(result, actionId) => void runAction(result, actionId)}
          />
        )}
      </main>
    </div>
  )
}

function SearchResultGroupHeader({
  label,
  count
}: {
  label: string
  count: number
}): React.JSX.Element {
  return (
    <div className="flex h-6 items-end justify-between px-2 pb-1 text-[10px] font-medium uppercase tracking-normal text-muted-foreground/70">
      <span className="truncate">{label}</span>
      <span>{count}</span>
    </div>
  )
}

function SearchResultRow({
  result,
  active,
  onMouseEnter,
  onClick,
  onContextMenu
}: {
  result: SearchResult
  active: boolean
  onMouseEnter(): void
  onClick(): void
  onContextMenu(event: MouseEvent<HTMLButtonElement>): void
}): React.JSX.Element {
  return (
    <button
      id={resultDomId(result.id)}
      role="option"
      aria-selected={active}
      type="button"
      disabled={result.disabled}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'grid h-[58px] w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 text-left transition-none active:transform-none',
        'focus-visible:outline-none',
        active ? 'bg-primary/[0.16]' : 'hover:bg-muted/25',
        result.disabled && 'cursor-not-allowed opacity-55'
      )}
    >
      <QuickResultIcon result={result} active={active} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{result.title}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {(result.reason || result.subtitle) && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {result.reason || result.subtitle}
            </span>
          )}
          <ResultBrickIdentity result={result} />
        </div>
      </div>
      <div className="flex max-w-[180px] items-center gap-2 text-[11px] text-muted-foreground">
        {result.requiresInput && <span className="text-warning">需输入</span>}
        <ResultBadge result={result} />
      </div>
    </button>
  )
}

/** 结果归属 Brick 身份（brickId + origin + version 纯文本，紧凑模式）。 */
function ResultBrickIdentity({ result }: { result: SearchResult }): React.JSX.Element | null {
  if (!result.brickId) return null
  const originLabel =
    result.origin === 'development'
      ? '开发'
      : result.origin === 'review'
        ? '审核'
        : result.origin === 'installed'
          ? '已安装'
          : undefined
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground/80">
      <span className="truncate">{result.brickId}</span>
      {originLabel && <span className="shrink-0">· {originLabel}</span>}
      {result.version && <span className="shrink-0">v{result.version}</span>}
    </span>
  )
}

function ResultBadge({ result }: { result: SearchResult }): React.JSX.Element {
  const label =
    result.presentation?.badge ||
    result.accessory ||
    result.providerLabel ||
    result.category ||
    result.kind
  return (
    <span
      className={cn(
        'truncate rounded-sm border border-transparent px-1.5 py-0.5 font-mono',
        badgeToneClass(result.presentation?.badgeTone)
      )}
      style={
        result.presentation?.accentColor
          ? { borderColor: result.presentation.accentColor, color: result.presentation.accentColor }
          : undefined
      }
    >
      {label}
    </span>
  )
}

function QuickResultIcon({
  result,
  active
}: {
  result: SearchResult
  active: boolean
}): React.JSX.Element {
  const src = useMemo(() => iconSrc(result), [result])
  const [failed, setFailed] = useState(false)

  return (
    <div
      className={cn(
        'grid size-9 shrink-0 place-items-center overflow-hidden rounded-md text-xs font-semibold',
        active ? 'bg-background/75 text-foreground' : 'bg-muted/45 text-muted-foreground'
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <BrickFallbackIcon className="size-4" />
      )}
    </div>
  )
}

function QuickSearchActionMenu({
  result,
  x,
  y,
  onClose,
  onRunAction
}: {
  result: SearchResult | undefined
  x: number
  y: number
  onClose(): void
  onRunAction(result: SearchResult, actionId: string): void
}): React.JSX.Element | null {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  if (!result?.actions?.length) return null
  const actions = result.actions ?? []
  const menuX = clampNumber(x, 8, Math.max(8, window.innerWidth - ACTION_MENU_WIDTH - 8))
  const menuY = clampNumber(y, 8, Math.max(8, window.innerHeight - ACTION_MENU_MAX_HEIGHT - 8))

  return (
    <div
      role="menu"
      className="absolute z-50 min-w-[200px] overflow-hidden rounded-md bg-zinc-900 py-1 text-xs shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
      style={{ left: menuX, top: menuY }}
      onClick={(event) => event.stopPropagation()}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className={cn(
            'flex h-8 w-full items-center justify-between px-3 text-left hover:bg-muted/25',
            action.destructive ? 'text-destructive' : 'text-foreground'
          )}
          onClick={() => onRunAction(result, action.id)}
        >
          <span className="truncate">{action.title}</span>
        </button>
      ))}
    </div>
  )
}

function getNavigationDirection(event: React.KeyboardEvent<HTMLInputElement>): -1 | 1 | undefined {
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return 1
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return -1
  if (event.getModifierState('NumLock')) return undefined
  if (event.code === 'Numpad2' || event.code === 'Numpad6') return 1
  if (event.code === 'Numpad8' || event.code === 'Numpad4') return -1
  return undefined
}

function buildDisplayRows(results: SearchResult[]): DisplayRow[] {
  const rows: DisplayRow[] = []
  let index = 0
  while (index < results.length) {
    const start = index
    const providerId = providerGroupKey(results[index])
    while (index < results.length && providerGroupKey(results[index]) === providerId) {
      index += 1
    }
    const count = index - start
    const first = results[start]
    if (count >= 2) {
      rows.push({
        type: 'group',
        id: `group:${providerId}:${start}`,
        label: first.providerLabel || first.category || first.kind,
        count
      })
    }
    for (let resultIndex = start; resultIndex < index; resultIndex += 1) {
      rows.push({ type: 'result', result: results[resultIndex], resultIndex })
    }
  }
  return rows
}

function providerGroupKey(result: SearchResult): string {
  return result.providerId || result.providerLabel || result.kind
}

function menuAnchorForResult(resultId: string): { x: number; y: number } {
  const rect = document.getElementById(resultDomId(resultId))?.getBoundingClientRect()
  if (!rect) return { x: Math.max(8, window.innerWidth - ACTION_MENU_WIDTH - 8), y: 74 }
  return {
    x: rect.right - ACTION_MENU_WIDTH,
    y: rect.top + 8
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function badgeToneClass(tone: BadgeTone | undefined): string {
  if (tone === 'success') return 'bg-emerald-500/10 text-emerald-300'
  if (tone === 'warning') return 'bg-amber-500/10 text-amber-300'
  if (tone === 'danger') return 'bg-red-500/10 text-red-300'
  if (tone === 'info') return 'bg-sky-500/10 text-sky-300'
  return 'bg-muted/30 text-muted-foreground'
}

function resultDomId(resultId: string): string {
  return `${ROW_ID_PREFIX}-${resultId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

/** 输入框右侧留白区是拖拽把手：pointer down 让 runtime 调 startDrag 进宿主原生拖拽。 */
function DragMask({
  left,
  width,
  onClick
}: {
  left: number
  width: number
  onClick(): void
}): React.JSX.Element | null {
  if (width <= 0) return null

  const onDragStart = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    startDrag()
  }

  const onDragEnd = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    endDrag()
  }

  return (
    <div
      className="absolute top-0 z-20 h-full cursor-default bg-transparent"
      style={{ left, width }}
      onClick={onClick}
      onPointerDown={onDragStart}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onLostPointerCapture={() => endDrag()}
    />
  )
}

function useInputMeasuredWidth(
  inputRef: RefObject<HTMLInputElement | null>,
  value: string,
  placeholder: string
): number {
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return

    const style = window.getComputedStyle(input)
    context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const textWidth = context.measureText(value || placeholder).width
    setWidth(Math.ceil(textWidth + 16))
  }, [inputRef, placeholder, value])

  return width
}

function iconSrc(result: SearchResult): string | undefined {
  const icon = result.icon?.trim()
  if (!icon || !isImageLike(icon)) return undefined
  if (/^(data:image\/|https?:\/\/|file:\/\/)/i.test(icon)) return icon
  if (!result.rootDir) return undefined
  if (/^[a-zA-Z]:[\\/]/.test(icon) || icon.startsWith('/') || icon.startsWith('\\\\')) {
    return toFileUrl(icon)
  }
  return toFileUrl(`${result.rootDir.replace(/[\\/]$/, '')}/${icon}`)
}

function isImageLike(icon: string): boolean {
  if (/^(data:image\/|https?:\/\/|file:\/\/)/i.test(icon)) return true
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(icon)
}

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(`file://${withSlash}`)
}
