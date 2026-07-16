import { useEffect, useRef, useState } from 'react'
import type { CropRect } from '../types'

interface CropOverlayProps {
  imageRef: React.RefObject<HTMLImageElement | null>
  containerRef: React.RefObject<HTMLElement | null>
  onChange: (rect: CropRect) => void
  enabled: boolean
  aspectRatio?: number | null
}

type HandleDir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function imageBox(img: HTMLImageElement, container: HTMLElement): Box {
  const ir = img.getBoundingClientRect()
  const cr = container.getBoundingClientRect()
  return {
    left: ir.left - cr.left,
    top: ir.top - cr.top,
    width: Math.max(1, ir.width),
    height: Math.max(1, ir.height),
  }
}

function toNatural(box: Box, img: HTMLImageElement, container: HTMLElement): CropRect {
  const ib = imageBox(img, container)
  const sx = img.naturalWidth / ib.width
  const sy = img.naturalHeight / ib.height
  return {
    x: Math.max(0, Math.round((box.left - ib.left) * sx)),
    y: Math.max(0, Math.round((box.top - ib.top) * sy)),
    width: Math.max(1, Math.round(box.width * sx)),
    height: Math.max(1, Math.round(box.height * sy)),
  }
}

function clamp(box: Box, img: HTMLImageElement, container: HTMLElement): Box {
  const ib = imageBox(img, container)
  let { left, top, width, height } = box
  width = Math.max(24, Math.min(width, ib.width))
  height = Math.max(24, Math.min(height, ib.height))
  left = Math.max(ib.left, Math.min(left, ib.left + ib.width - width))
  top = Math.max(ib.top, Math.min(top, ib.top + ib.height - height))
  return { left, top, width, height }
}

/**
 * Drag crop overlay. Self-contained display state — does NOT re-read `rect`
 * from parent on every render (that previously reset the box while dragging).
 */
export function CropOverlay({
  imageRef,
  containerRef,
  onChange,
  enabled,
  aspectRatio = null,
}: CropOverlayProps) {
  const [box, setBox] = useState<Box | null>(null)
  const boxRef = useRef<Box | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const aspectRef = useRef(aspectRatio)
  aspectRef.current = aspectRatio
  const dragKind = useRef<'move' | HandleDir | null>(null)
  const dragStart = useRef({ x: 0, y: 0, box: { left: 0, top: 0, width: 0, height: 0 } })

  const publish = (next: Box) => {
    const img = imageRef.current
    const container = containerRef.current
    if (!img || !container) return
    const c = clamp(next, img, container)
    boxRef.current = c
    setBox(c)
    onChangeRef.current(toNatural(c, img, container))
  }

  const initBox = () => {
    const img = imageRef.current
    const container = containerRef.current
    if (!img || !container || !img.naturalWidth || img.clientWidth < 4) return false

    const ib = imageBox(img, container)
    let w = ib.width * 0.65
    let h = ib.height * 0.65
    const ar = aspectRef.current
    if (ar && ar > 0) {
      if (w / h > ar) w = h * ar
      else h = w / ar
      if (w > ib.width) {
        w = ib.width * 0.9
        h = w / ar
      }
      if (h > ib.height) {
        h = ib.height * 0.9
        w = h * ar
      }
    }
    publish({
      left: ib.left + (ib.width - w) / 2,
      top: ib.top + (ib.height - h) / 2,
      width: w,
      height: h,
    })
    return true
  }

  // Init once when enabled / image loads / aspect changes.
  // Do NOT re-init on every parent re-render or ResizeObserver tick (that kills drag).
  useEffect(() => {
    if (!enabled) {
      setBox(null)
      boxRef.current = null
      return
    }

    let cancelled = false
    let done = false
    const tryInit = () => {
      if (cancelled || done) return
      if (initBox()) {
        done = true
        return
      }
      requestAnimationFrame(tryInit)
    }

    const img = imageRef.current
    const onLoad = () => {
      done = false
      tryInit()
    }
    if (img) img.addEventListener('load', onLoad)
    tryInit()

    return () => {
      cancelled = true
      img?.removeEventListener('load', onLoad)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, aspectRatio, imageRef, containerRef])

  useEffect(() => {
    if (!enabled || !box) return

    const onMove = (ev: PointerEvent) => {
      const kind = dragKind.current
      if (!kind || !boxRef.current) return
      const img = imageRef.current
      const container = containerRef.current
      if (!img || !container) return

      const dx = ev.clientX - dragStart.current.x
      const dy = ev.clientY - dragStart.current.y
      const s = dragStart.current.box
      let left = s.left
      let top = s.top
      let width = s.width
      let height = s.height
      const ar = aspectRef.current

      if (kind === 'move') {
        left = s.left + dx
        top = s.top + dy
      } else {
        if (kind.includes('e')) width = s.width + dx
        if (kind.includes('s')) height = s.height + dy
        if (kind.includes('w')) {
          width = s.width - dx
          left = s.left + dx
        }
        if (kind.includes('n')) {
          height = s.height - dy
          top = s.top + dy
        }
        if (ar && ar > 0) {
          if (kind === 'e' || kind === 'w' || kind === 'se' || kind === 'ne' || kind === 'sw' || kind === 'nw') {
            if (kind === 'e' || kind === 'w') height = width / ar
            else if (kind === 'n' || kind === 's') width = height * ar
            else if (kind === 'se' || kind === 'ne') height = width / ar
            else width = height * ar

            if (kind === 'nw' || kind === 'sw' || kind === 'w') {
              left = s.left + s.width - width
            }
            if (kind === 'nw' || kind === 'ne' || kind === 'n') {
              top = s.top + s.height - height
            }
          }
        }
      }

      publish({ left, top, width, height })
    }

    const onUp = () => {
      dragKind.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [enabled, box, imageRef, containerRef])

  if (!enabled || !box) return null

  const startDrag = (kind: 'move' | HandleDir, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!boxRef.current) return
    dragKind.current = kind
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      box: { ...boxRef.current },
    }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const handles: { dir: HandleDir; className: string }[] = [
    { dir: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
    { dir: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
    { dir: 'sw', className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
    { dir: 'se', className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
    { dir: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
    { dir: 's', className: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
    { dir: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
    { dir: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  ]

  return (
    <div
      className="absolute z-30 box-border border-2 border-[var(--ac)] bg-[var(--ac)]/10"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        // Dim outside without giant shadow hit-testing quirks
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
        touchAction: 'none',
        cursor: 'move',
        userSelect: 'none',
      }}
      onPointerDown={(e) => startDrag('move', e)}
    >
      {handles.map((h) => (
        <span
          key={h.dir}
          className={`absolute z-40 h-4 w-4 rounded-sm border-2 border-white bg-[var(--ac)] shadow ${h.className}`}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            e.stopPropagation()
            startDrag(h.dir, e)
          }}
        />
      ))}
    </div>
  )
}
