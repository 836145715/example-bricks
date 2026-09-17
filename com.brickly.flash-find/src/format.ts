/** 展示层纯函数：体积/时间格式化与查询分词高亮。 */

export function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDate(epochSec: number): string {
  if (!Number.isFinite(epochSec) || epochSec <= 0) return '—'
  const d = new Date(epochSec * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 提取用于高亮的普通词项：按空白分词，丢弃 ext:/path: 等过滤器 token；
 * 引号短语（"a b"）合并为一个词，过滤器引号参数（path:"a b"）整体跳过。
 */
export function highlightTerms(query: string): string[] {
  const terms: string[] = []
  const tokens = query.split(/\s+/).filter((t) => t !== '')
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (/^[a-zA-Z]+:/.test(tok)) {
      // 过滤器：若引号参数未闭合，吞掉后续 token 直到闭合
      if ((tok.match(/"/g) ?? []).length % 2 === 1) {
        while (++i < tokens.length && !tokens[i].includes('"')) {
          /* 吞 */
        }
      }
      continue
    }
    if (tok.includes('"')) {
      // 带引号短语：合并到闭合引号
      let phrase = tok
      if ((phrase.match(/"/g) ?? []).length % 2 === 1) {
        while (++i < tokens.length) {
          phrase += ' ' + tokens[i]
          if (tokens[i].includes('"')) break
        }
      }
      const inner = phrase.replace(/"/g, '').trim()
      if (inner !== '') terms.push(inner)
      continue
    }
    terms.push(tok)
  }
  return terms
}

export interface HighlightPart {
  text: string
  hit: boolean
}

/** 在 name 上做大小写不敏感的多词高亮分割（贪心左到右）。 */
export function highlightParts(name: string, terms: string[]): HighlightPart[] {
  const lower = name.toLowerCase()
  const hits = new Array<boolean>(name.length).fill(false)
  for (const term of terms) {
    const t = term.toLowerCase()
    if (t === '') continue
    let from = 0
    for (;;) {
      const idx = lower.indexOf(t, from)
      if (idx < 0) break
      for (let i = idx; i < idx + t.length; i++) hits[i] = true
      from = idx + t.length
    }
  }
  const parts: HighlightPart[] = []
  for (let i = 0; i < name.length; ) {
    const h = hits[i]
    let j = i + 1
    while (j < name.length && hits[j] === h) j++
    parts.push({ text: name.slice(i, j), hit: h })
    i = j
  }
  return parts.length > 0 ? parts : [{ text: name, hit: false }]
}
