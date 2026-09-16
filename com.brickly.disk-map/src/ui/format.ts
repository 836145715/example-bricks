import type { NodeSummary } from './types'

/** 字节数与路径格式化工具 */

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** 旭日图 / 列表里的占比 */
export function formatShare(bytes: number, total: number): string {
  if (total <= 0 || bytes <= 0) return '0%'
  const pct = (bytes / total) * 100
  if (pct >= 10) return `${Math.round(pct)}%`
  if (pct >= 1) return `${pct.toFixed(1)}%`
  return '<1%'
}

/** 路径缩略：保留首尾，中间用 … */
export function shortenPath(path: string, max = 44): string {
  if (path.length <= max) return path
  const head = path.slice(0, Math.floor(max * 0.4))
  const tail = path.slice(-Math.floor(max * 0.45))
  return `${head}…${tail}`
}

/** 面包屑分段：/Users/xuan/Library/Caches → ['/', 'Users', 'xuan', ...] */
export function pathSegments(path: string): string[] {
  if (!path) return []
  const parts = path.split('/').filter(Boolean)
  return path.startsWith('/') ? ['/', ...parts] : parts
}

/** 由前缀段数组还原路径：['/', 'Users', 'xuan'] → '/Users/xuan' */
export function joinSegments(segments: string[]): string {
  if (segments.length === 0) return '/'
  if (segments[0] === '/') return '/' + segments.slice(1).join('/')
  return segments.join('/')
}

/** 旭日图配色：按名字稳定散列到色相环 */
export function kindHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

export function kindLabel(flags: { kind: string; mount: boolean; inaccessible: boolean; protected: boolean; dataless: boolean }): string[] {
  const badges: string[] = []
  if (flags.protected) badges.push('锁定')
  if (flags.mount) badges.push('其他卷')
  if (flags.inaccessible) badges.push('无权限')
  if (flags.dataless) badges.push('数据未载入')
  if (flags.kind === 'link') badges.push('链接')
  return badges
}

export type ExtCategory = 'video' | 'audio' | 'image' | 'archive' | 'code' | 'doc' | 'disk' | 'dir' | 'other'

const EXT_SETS: Record<Exclude<ExtCategory, 'dir' | 'other'>, ReadonlySet<string>> = {
  video: new Set(['mp4', 'mov', 'mkv', 'avi', 'm4v']),
  audio: new Set(['mp3', 'wav', 'flac', 'aac', 'm4a']),
  image: new Set(['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'svg', 'psd', 'raw']),
  archive: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'dmg', 'pkg', 'iso']),
  code: new Set(['js', 'ts', 'jsx', 'tsx', 'go', 'py', 'rb', 'rs', 'java', 'c', 'h', 'cpp', 'json', 'xml', 'yaml', 'yml', 'html', 'css']),
  doc: new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key', 'md', 'txt']),
  disk: new Set(['sparseimage', 'sparsebundle', 'cdr', 'vmdk', 'qcow2'])
}

const CATEGORY_HSL: Record<ExtCategory, string> = {
  video: 'hsl(350 46% 42%)',
  audio: 'hsl(280 36% 42%)',
  image: 'hsl(198 42% 40%)',
  archive: 'hsl(32 48% 42%)',
  code: 'hsl(164 38% 36%)',
  doc: 'hsl(190 32% 40%)',
  disk: 'hsl(215 14% 38%)',
  dir: 'hsl(164 26% 34%)',
  other: 'hsl(170 10% 30%)'
}

function normalizeExt(ext: string): string {
  const trimmed = ext.trim().toLowerCase()
  if (!trimmed || trimmed === '(无后缀)') return ''
  return trimmed.replace(/^\./, '')
}

/** 文件名里的后缀（含点，小写）；没有则空串。 */
export function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i).toLowerCase()
}

export function extCategory(ext: string, name?: string): ExtCategory {
  if (name && name.toLowerCase() === 'docker.raw') return 'disk'
  const key = normalizeExt(ext)
  if (!key) return 'other'
  const order: Exclude<ExtCategory, 'dir' | 'other'>[] = ['video', 'audio', 'image', 'archive', 'code', 'doc', 'disk']
  for (const cat of order) {
    if (EXT_SETS[cat].has(key)) return cat
  }
  return 'other'
}

export function categoryColor(cat: ExtCategory): string {
  return CATEGORY_HSL[cat]
}

/** 目录按名字散列；文件按扩展名分类色。ring=2 时再压一档，避免在暗底上发飘。 */
export function nodeFill(summary: NodeSummary, ring: 1 | 2 = 1): string {
  if (summary.flags.kind === 'dir') {
    const hue = kindHue(summary.name)
    const sat = ring === 1 ? 34 : 26
    const light = ring === 1 ? 34 : 28
    return `hsl(${hue} ${sat}% ${light}%)`
  }
  if (summary.flags.kind === 'link' || summary.flags.kind === 'other') {
    return ring === 1 ? CATEGORY_HSL.other : 'hsl(170 8% 24%)'
  }
  const cat = extCategory(fileExt(summary.name), summary.name)
  if (ring === 1) return categoryColor(cat)
  return categoryColor(cat).replace(/(\d+(?:\.\d+)?)%\)$/, (_, light) => `${Math.max(22, Number(light) - 6)}%)`)
}

export function fitText(text: string, maxPx: number, charW = 6.2): string {
  if (maxPx <= 0) return ''
  if (text.length * charW <= maxPx) return text
  const n = Math.max(0, Math.floor(maxPx / charW) - 1)
  return n <= 0 ? '' : `${text.slice(0, n)}…`
}
