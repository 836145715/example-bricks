import { useCallback, useEffect, useRef, useState } from 'react'
import type { CropRect } from '../types'

interface CropOverlayProps {
  imageRef: React.RefObject<HTMLImageElement | null>
  /** Positioning root (must be position:relative and contain the image) */
  containerRef: React.RefObject<HTMLElement | null>
  rect: CropRect
  onChange: (rect: CropRect) => void
  enabled: boolean
  aspectRatio?: number | null
}

type HandleDir = 'nw' | 'ne' | 'sw' | 'se'

interface DisplayBox {
  left: number
  top: number
  width: number
  height: number
}

/** Image rect relative to container (display pixels). */
function getImageDisplayBox(
  img: HTMLImageElement,
  container: HTMLElement,
): DisplayBox {
  const ir = img.getBoundingClientRect()
  const cr = container.getBoundingClientRect()
  return {
    left: ir.left - cr.left,
    top: ir.top - cr.top,
    width: Math.max(1, ir.width),
    height: Math.max(1, ir.height),
  }
}

function naturalToDisplay(
  rect: CropRect,
  img: HTMLImageElement,
  container: HTMLElement,
): DisplayBox {
  const box = getImageDisplayBox(img, container)
  const scaleX = box.width / Math.max(1, img.naturalWidth)
  const scaleY = box.height / Math.max(1, img.naturalHeight)
  return {
    left: box.left + rect.x * scaleX,
    top: box.top + rect.y * scaleY,
    width: Math.max(8, rect.width * scaleX),
    height: Math.max(8, rect.height * scaleY),
  }
}

function displayToNatural(
  box: DisplayBox,
  img: HTMLImageElement,
  container: HTMLElement,
): CropRect {
  const ib = getImageDisplayBox(img, container)
  const scaleX = img.naturalWidth / Math.max(1, ib.width)
  const scaleY = img.naturalHeight / Math.max(1, ib.height)
  return {
    x: Math.max(0, Math.round((box.left - ib.left) * scaleX)),
    y: Math.max(0, Math.round((box.top - ib.top) * scaleY)),
    width: Math.max(1, Math.round(box.width * scaleX)),
    height: Math.max(1, Math.round(box.height * scaleY)),
  }
}

export function CropOverlay({
  imageRef,
  containerRef,
  rect,
  onChange,
  enabled,
  aspectRatio = null,
}: CropOverlayProps) {
  const [box, setBox] = useState<DisplayBox>({
    left: 0,
    top: 0,
    width: 120,
    height: 120,
  })
  const boxRef = useRef(box)
  boxRef.current = box
  const initialized = useRef(false)
  const dragging = useRef(false)

  const syncFromImage = useCallback(
    (forceInit = false) => {
      const img = imageRef.current
      const container = containerRef.current
      if (!img || !container || !img.naturalWidth || img.clientWidth < 2) return

      if (forceInit || !initialized.current) {
        const ib = getImageDisplayBox(img, container)
        let w = Math.min(ib.width * 0.7, Math.max(80, ib.width * 0.6))
        let h = Math.min(ib.height * 0.7, Math.max(80, ib.height * 0.6))
        if (aspectRatio && aspectRatio > 0) {
          if (w / h > aspectRatio) w = h * aspectRatio
          else h = w / aspectRatio
          // fit inside image
          if (w > ib.width) {
            w = ib.width * 0.9
            h = w / aspectRatio
          }
          if (h > ib.height) {
            h = ib.height * 0.9
            w = h * aspectRatio
          }
        }
        const left = ib.left + (ib.width - w) / 2
        const top = ib.top + (ib.height - h) / 2
        const next = { left, top, width: w, height: h }
        setBox(next)
        boxRef.current = next
        onChange(displayToNatural(next, img, container))
        initialized.current = true
        return
      }

      if (dragging.current) return
      const next = naturalToDisplay(rect, img, container)
      setBox(next)
      boxRef.current = next
    },
    [imageRef, containerRef, onChange, rect, aspectRatio],
  )

  useEffect(() => {
    if (!enabled) {
      initialized.current = false
      return
    }
    const img = imageRef.current
    if (!img) return

    const onLoad = () => {
      initialized.current = false
      requestAnimationFrame(() => syncFromImage(true))
    }
    const onWinResize = () => {
      if (!dragging.current) syncFromImage(false)
    }

    if (img.complete && img.naturalWidth) {
      requestAnimationFrame(() => syncFromImage(true))
    }
    img.addEventListener('load', onLoad)
    window.addEventListener('resize', onWinResize)

    const container = containerRef.current
    let ro: ResizeObserver | null = null
    if (container && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (!dragging.current) syncFromImage(false)
      })
      ro.observe(container)
      ro.observe(img)
    }

    return () => {
      img.removeEventListener('load', onLoad)
      window.removeEventListener('resize', onWinResize)
      ro?.disconnect()
    }
  }, [enabled, imageRef, containerRef, syncFromImage])

  // Re-init when aspect ratio changes
  useEffect(() => {
    if (!enabled) return
    initialized.current = false
    requestAnimationFrame(() => syncFromImage(true))
  }, [aspectRatio, enabled, syncFromImage])

  if (!enabled) return null

  const clampBox = (next: DisplayBox): DisplayBox => {
    const img = imageRef.current
    const container = containerRef.current
    if (!img || !container) return next
    const ib = getImageDisplayBox(img, container)
    let { left, top, width, height } = next
    width = Math.max(24, Math.min(width, ib.width))
    height = Math.max(24, Math.min(height, ib.height))
    left = Math.max(ib.left, Math.min(left, ib.left + ib.width - width))
    top = Math.max(ib.top, Math.min(top, ib.top + ib.height - height))
    return { left, top, width, height }
  }

  const commit = (next: DisplayBox) => {
    const clamped = clampBox(next)
    setBox(clamped)
    boxRef.current = clamped
    const img = imageRef.current
    const container = containerRef.current
    if (img && container) onChange(displayToNatural(clamped, img, container))
  }

  const onMoveStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    const startX = e.clientX
    const startY = e.clientY
    const start = { ...boxRef.current }

    const onMove = (ev: MouseEvent) => {
      commit({
        ...start,
        left: start.left + (ev.clientX - startX),
        top: start.top + (ev.clientY - startY),
      })
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const onResizeStart = (dir: HandleDir, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    const startX = e.clientX
    const startY = e.clientY
    const start = { ...boxRef.current }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let { left, top, width, height } = start

      if (dir.includes('e')) width = start.width + dx
      if (dir.includes('s')) height = start.height + dy
      if (dir.includes('w')) {
        width = start.width - dx
        left = start.left + dx
      }
      if (dir.includes('n')) {
        height = start.height - dy
        top = start.top + dy
      }

      if (aspectRatio && aspectRatio > 0) {
        if (dir === 'se' || dir === 'ne') height = width / aspectRatio
        else if (dir === 'sw' || dir === 'nw') {
          height = width / aspectRatio
        }
        if (dir === 'nw' || dir === 'sw') left = start.left + start.width - width
        if (dir === 'nw' || dir === 'ne') top = start.top + start.height - height
      }

      commit({ left, top, width, height })
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handles: HandleDir[] = ['nw', 'ne', 'sw', 'se']
  const handlePos: Record<HandleDir, string> = {
    nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
    ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
    sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
    se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  }

  return (
    <div
      className="pointer-events-auto absolute z-20 border-2 border-[var(--ac)] bg-[var(--ac)]/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        touchAction: 'none',
      }}
      onMouseDown={onMoveStart}
    >
      {handles.map((dir) => (
        <span
          key={dir}
          className={`absolute h-3.5 w-3.5 rounded-sm border border-[var(--ac-fg)] bg-[var(--ac)] ${handlePos[dir]}`}
          onMouseDown={(e) => onResizeStart(dir, e)}
        />
      ))}
    </div>
  )
}
