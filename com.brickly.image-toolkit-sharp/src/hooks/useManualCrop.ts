import { useCallback, useState } from 'react'
import type { CropRect } from '../types'

const DEFAULT_RECT: CropRect = { x: 0, y: 0, width: 200, height: 200 }

export function useManualCrop(initial?: CropRect) {
  const [rect, setRect] = useState<CropRect>(initial ?? DEFAULT_RECT)

  const updateRect = useCallback((next: Partial<CropRect> | CropRect) => {
    setRect((prev) => ({
      x: 'x' in next && next.x != null ? Math.max(0, Math.round(next.x)) : prev.x,
      y: 'y' in next && next.y != null ? Math.max(0, Math.round(next.y)) : prev.y,
      width:
        'width' in next && next.width != null
          ? Math.max(1, Math.round(next.width))
          : prev.width,
      height:
        'height' in next && next.height != null
          ? Math.max(1, Math.round(next.height))
          : prev.height,
    }))
  }, [])

  const resetRect = useCallback((next?: CropRect) => {
    setRect(next ?? DEFAULT_RECT)
  }, [])

  return {
    rect,
    setRect: updateRect,
    resetRect,
  }
}
