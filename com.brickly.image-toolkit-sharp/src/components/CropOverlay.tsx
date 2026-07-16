import { useCallback, useEffect, useRef, useState } from 'react'
import type { CropRect } from '../types'

interface CropOverlayProps {
  imageRef: React.RefObject<HTMLImageElement | null>
  rect: CropRect
  onChange: (rect: CropRect) => void
  enabled: boolean
  aspectRatio?: number | null
}

type HandleDir = 'nw' | 'ne' | 'sw' | 'se'

/**
 * Map natural-image crop rect to display coordinates relative to the image element.
 */
function naturalToDisplay(
  rect: CropRect,
  img: HTMLImageElement,
): { left: number; top: number; width: number; height: number } {
  const scaleX = img.clientWidth / Math.max(1, img.naturalWidth)
  const scaleY = img.clientHeight / Math.max(1, img.naturalHeight)
  return {
    left: img.offsetLeft + rect.x * scaleX,
    top: img.offsetTop + rect.y * scaleY,
    width: Math.max(8, rect.width * scaleX),
    height: Math.max(8, rect.height * scaleY),
  }
}

function displayToNatural(
  box: { left: number; top: number; width: number; height: number },
  img: HTMLImageElement,
): CropRect {
  const scaleX = img.naturalWidth / Math.max(1, img.clientWidth)
  const scaleY = img.naturalHeight / Math.max(1, img.clientHeight)
  return {
    x: Math.max(0, Math.round((box.left - img.offsetLeft) * scaleX)),
    y: Math.max(0, Math.round((box.top - img.offsetTop) * scaleY)),
    width: Math.max(1, Math.round(box.width * scaleX)),
    height: Math.max(1, Math.round(box.height * scaleY)),
  }
}

export function CropOverlay({
  imageRef,
  rect,
  onChange,
  enabled,
  aspectRatio = null,
}: CropOverlayProps) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 120, height: 120 })
  const boxRef = useRef(box)
  boxRef.current = box
  const initialized = useRef(false)

  const syncFromImage = useCallback(() => {
    const img = imageRef.current
    if (!img || !img.naturalWidth) return

    if (!initialized.current) {
      const cw = img.clientWidth
      const ch = img.clientHeight
      let w = Math.min(cw * 0.6, 240)
      let h = Math.min(ch * 0.6, 240)
      if (aspectRatio && aspectRatio > 0) {
        if (w / h > aspectRatio) w = h * aspectRatio
        else h = w / aspectRatio
      }
      const left = img.offsetLeft + (cw - w) / 2
      const top = img.offsetTop + (ch - h) / 2
      const next = { left, top, width: w, height: h }
      setBox(next)
      onChange(displayToNatural(next, img))
      initialized.current = true
      return
    }

    setBox(naturalToDisplay(rect, img))
  }, [imageRef, onChange, rect, aspectRatio])

  useEffect(() => {
    if (!enabled) {
      initialized.current = false
      return
    }
    const img = imageRef.current
    if (!img) return

    const onLoad = () => {
      initialized.current = false
      syncFromImage()
    }

    if (img.complete && img.naturalWidth) {
      syncFromImage()
    }
    img.addEventListener('load', onLoad)
    window.addEventListener('resize', syncFromImage)
    return () => {
      img.removeEventListener('load', onLoad)
      window.removeEventListener('resize', syncFromImage)
    }
  }, [enabled, imageRef, syncFromImage])

  // When aspectRatio changes, re-init box
  useEffect(() => {
    if (!enabled) return
    initialized.current = false
    syncFromImage()
  }, [aspectRatio, enabled, syncFromImage])

  if (!enabled) return null

  const clampBox = (next: typeof box) => {
    const img = imageRef.current
    if (!img) return next
    const minL = img.offsetLeft
    const minT = img.offsetTop
    const maxR = img.offsetLeft + img.clientWidth
    const maxB = img.offsetTop + img.clientHeight
    let { left, top, width, height } = next
    width = Math.max(20, Math.min(width, maxR - minL))
    height = Math.max(20, Math.min(height, maxB - minT))
    left = Math.max(minL, Math.min(left, maxR - width))
    top = Math.max(minT, Math.min(top, maxB - height))
    return { left, top, width, height }
  }

  const commit = (next: typeof box) => {
    const clamped = clampBox(next)
    setBox(clamped)
    const img = imageRef.current
    if (img) onChange(displayToNatural(clamped, img))
  }

  const onMoveStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
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
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const onResizeStart = (dir: HandleDir, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
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
        else width = height * aspectRatio
        if (dir === 'nw' || dir === 'sw') left = start.left + start.width - width
        if (dir === 'nw' || dir === 'ne') top = start.top + start.height - height
      }

      commit({ left, top, width, height })
    }
    const onUp = () => {
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
      className="absolute z-10 border-2 border-[var(--ac)] bg-[var(--ac)]/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
      onMouseDown={onMoveStart}
    >
      {handles.map((dir) => (
        <span
          key={dir}
          className={`absolute h-3 w-3 rounded-sm border border-[var(--ac-fg)] bg-[var(--ac)] ${handlePos[dir]}`}
          onMouseDown={(e) => onResizeStart(dir, e)}
        />
      ))}
    </div>
  )
}
