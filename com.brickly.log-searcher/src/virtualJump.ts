export type JumpAlign = 'start' | 'end' | 'center'

export const JUMP_MIN_WINDOW = 40

export interface JumpPeekWindow {
  offset: number
  limit: number
  renderStart: number
  renderEnd: number
}

/**
 * 跳转时只预取视口附近的结果窗口，避免一次挂上几十行未测量的换行日志。
 */
export const getJumpPeekWindow = (
  totalCount: number,
  targetIndex: number,
  align: JumpAlign,
  visibleCount: number,
  overscan: number,
  maxLimit: number
): JumpPeekWindow => {
  const safeTotal = Math.max(0, totalCount)
  if (safeTotal <= 0) {
    return { offset: 0, limit: 0, renderStart: 0, renderEnd: 0 }
  }

  const windowSize = Math.min(
    maxLimit,
    Math.min(Math.max(visibleCount + overscan * 2, JUMP_MIN_WINDOW), safeTotal)
  )
  const lastIndex = safeTotal - 1

  if (align === 'start') {
    return {
      offset: 0,
      limit: windowSize,
      renderStart: 0,
      renderEnd: Math.max(0, windowSize - 1)
    }
  }

  if (align === 'end') {
    const offset = Math.max(0, safeTotal - windowSize)
    return {
      offset,
      limit: safeTotal - offset,
      renderStart: offset,
      renderEnd: lastIndex
    }
  }

  const offset = Math.max(0, Math.min(targetIndex - Math.floor(windowSize / 2), safeTotal - windowSize))
  return {
    offset,
    limit: windowSize,
    renderStart: offset,
    renderEnd: Math.min(lastIndex, offset + windowSize - 1)
  }
}
