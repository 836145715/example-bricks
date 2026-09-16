import type { GenerateStyleSnapshot, HistoryItem } from '../types'

export const HISTORY_KEY = 'com.brickly.qr-toolkit.history'
export const GENERATE_PREFS_KEY = 'com.brickly.qr-toolkit.generate-prefs'
export const HISTORY_LIMIT = 50

const DEFAULT_STYLE: GenerateStyleSnapshot = {
  size: 256,
  margin: 2,
  errorCorrection: 'M',
  moduleStyle: 'square',
  darkColor: '#000000',
  lightColor: '#ffffff',
}

export function loadGeneratePrefs(): GenerateStyleSnapshot {
  try {
    const raw = localStorage.getItem(GENERATE_PREFS_KEY)
    if (!raw) return { ...DEFAULT_STYLE }
    const p = JSON.parse(raw) as Partial<GenerateStyleSnapshot>
    return normalizeStyle(p)
  } catch {
    return { ...DEFAULT_STYLE }
  }
}

export function saveGeneratePrefs(style: GenerateStyleSnapshot): void {
  try {
    localStorage.setItem(GENERATE_PREFS_KEY, JSON.stringify(normalizeStyle(style)))
  } catch {
    /* ignore quota */
  }
}

export function normalizeStyle(
  input?: Partial<GenerateStyleSnapshot> | null,
): GenerateStyleSnapshot {
  const size = Number(input?.size)
  const margin = Number(input?.margin)
  const ec = String(input?.errorCorrection || DEFAULT_STYLE.errorCorrection).toUpperCase()
  const ms = String(input?.moduleStyle || DEFAULT_STYLE.moduleStyle).toLowerCase()
  return {
    size: Number.isFinite(size) ? Math.min(2048, Math.max(64, Math.round(size))) : DEFAULT_STYLE.size,
    margin: Number.isFinite(margin)
      ? Math.min(16, Math.max(0, Math.round(margin)))
      : DEFAULT_STYLE.margin,
    errorCorrection: (['L', 'M', 'Q', 'H'].includes(ec)
      ? ec
      : DEFAULT_STYLE.errorCorrection) as GenerateStyleSnapshot['errorCorrection'],
    moduleStyle: (['square', 'rounded', 'dots'].includes(ms)
      ? ms
      : DEFAULT_STYLE.moduleStyle) as GenerateStyleSnapshot['moduleStyle'],
    darkColor:
      typeof input?.darkColor === 'string' && input.darkColor.trim()
        ? input.darkColor.trim()
        : DEFAULT_STYLE.darkColor,
    lightColor:
      typeof input?.lightColor === 'string' && input.lightColor.trim()
        ? input.lightColor.trim()
        : DEFAULT_STYLE.lightColor,
  }
}

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is HistoryItem => !!item && typeof item === 'object' && typeof (item as HistoryItem).id === 'string')
      .slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

export function saveHistory(items: HistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)))
  } catch {
    // QuotaExceeded: drop thumbs and retry
    try {
      const slim = items.slice(0, HISTORY_LIMIT).map((item) => ({
        ...item,
        previewThumb: undefined,
        qrDataUrl:
          item.qrDataUrl && item.qrDataUrl.length > 4000 ? undefined : item.qrDataUrl,
      }))
      localStorage.setItem(HISTORY_KEY, JSON.stringify(slim))
    } catch {
      /* ignore */
    }
  }
}

export function makeHistoryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function truncateText(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}
