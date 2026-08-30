import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

const STORAGE_KEY = 'com.brickly.local-search.previewRatio'
const DEFAULT_RATIO = 0.3
const MIN_LIST = 280
const MIN_PREVIEW = 200
const STEP = 0.02

function readStoredRatio() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = raw ? Number(raw) : DEFAULT_RATIO
    return Number.isFinite(value) ? value : DEFAULT_RATIO
  } catch {
    return DEFAULT_RATIO
  }
}

function persistRatio(value: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    /* ignore quota / private mode */
  }
}

function clampRatio(ratio: number, total: number) {
  if (total <= MIN_LIST + MIN_PREVIEW) return ratio
  const min = MIN_PREVIEW / total
  const max = 1 - MIN_LIST / total
  return Math.min(max, Math.max(min, ratio))
}

export function WorkspaceSplit({ left, right }: { left: ReactNode; right: ReactNode }) {
  const wrapRef = useRef<HTMLElement | null>(null)
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [dragging, setDragging] = useState(false)
  const ratioRef = useRef(ratio)
  ratioRef.current = ratio

  useEffect(() => {
    setRatio(readStoredRatio())
  }, [])

  const applyRatio = useCallback((next: number, persist = false) => {
    const total = wrapRef.current?.getBoundingClientRect().width || 0
    const clamped = clampRatio(next, total || 1)
    setRatio(clamped)
    if (persist) persistRatio(clamped)
  }, [])

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }, [])

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!dragging || !wrapRef.current) return
      const rect = wrapRef.current.getBoundingClientRect()
      applyRatio((rect.right - event.clientX) / rect.width)
    },
    [applyRatio, dragging]
  )

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    persistRatio(ratioRef.current)
  }, [dragging])

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      applyRatio(ratioRef.current)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [applyRatio])

  return (
    <section
      ref={wrapRef}
      className={clsx('workspace', dragging && 'is-resizing')}
      style={{ ['--preview-width' as string]: `${ratio * 100}%` }}
    >
      {left}
      <button
        type="button"
        className="workspace-split"
        aria-label="调节预览宽度"
        aria-orientation="vertical"
        role="separator"
        aria-valuemin={20}
        aria-valuemax={70}
        aria-valuenow={Math.round(ratio * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => applyRatio(DEFAULT_RATIO, true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            applyRatio(ratio + STEP, true)
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            applyRatio(ratio - STEP, true)
          } else if (event.key === 'Home') {
            event.preventDefault()
            applyRatio(DEFAULT_RATIO, true)
          }
        }}
      />
      {right}
    </section>
  )
}
