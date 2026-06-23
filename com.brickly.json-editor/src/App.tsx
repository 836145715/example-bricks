import Editor, { type OnMount } from '@monaco-editor/react'
import clsx from 'clsx'
import {
  AlignJustify,
  Braces,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  Download,
  Eraser,
  Minimize2,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  WrapText
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'

type NoticeKind = 'idle' | 'ok' | 'warn' | 'error'

type Notice = {
  text: string
  kind: NoticeKind
}

type JsonStats = {
  valid: boolean
  type: string
  size: number
  lines: number
  nodes: number
  depth: number
  error?: string
}

type QueryResult = { ok: true; value: unknown } | { ok: false; error: string }

type FilterResult =
  | { active: false; ok: false; text: '' }
  | { active: true; ok: true; text: string; value: unknown }
  | { active: true; ok: false; text: string }

export function App() {
  const [value, setValue] = useState('')
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState<Notice>({
    text: 'URL Params、XML、YAML 粘贴自动转为 JSON',
    kind: 'idle'
  })
  const [wrap, setWrap] = useState(false)
  const [indent, setIndent] = useState(2)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const parsed = useMemo(() => parseJson(value), [value])
  const stats = useMemo(() => jsonStats(value, parsed), [parsed, value])
  const filterResult = useMemo<FilterResult>(() => {
    const expression = filter.trim()
    if (!expression) return { active: false, ok: false, text: '' }
    if (!parsed.ok) return { active: true, ok: false, text: parsed.error }
    const result = queryJson(parsed.value, expression)
    if (!result.ok) return { active: true, ok: false, text: result.error }
    return {
      active: true,
      ok: true,
      text: formatJsonValue(result.value, indent),
      value: result.value
    }
  }, [filter, indent, parsed])

  const sourceEditorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      minimap: { enabled: false },
      wordWrap: wrap ? 'on' : 'off',
      fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 21,
      tabSize: indent,
      insertSpaces: true,
      padding: { top: 0, bottom: 24 },
      scrollBeyondLastLine: false,
      overviewRulerBorder: false,
      renderLineHighlight: 'none',
      glyphMargin: false,
      folding: true,
      lineNumbersMinChars: 3,
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: true },
      automaticLayout: true
    }),
    [indent, wrap]
  )

  const previewEditorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      ...sourceEditorOptions,
      readOnly: true,
      domReadOnly: true,
      wordWrap: 'on',
      renderLineHighlight: 'none'
    }),
    [sourceEditorOptions]
  )

  const setEditorValue = useCallback((next: string, message?: string, kind: NoticeKind = 'ok') => {
    setValue(next)
    editorRef.current?.setValue(next)
    if (message) setNotice({ text: message, kind })
  }, [])

  const onMount: OnMount = (instance) => {
    editorRef.current = instance
    instance.focus()
  }

  const format = () => {
    const result = parseJson(value)
    if (!result.ok) {
      setNotice({ text: result.error, kind: 'error' })
      return
    }
    setEditorValue(JSON.stringify(result.value, null, indent), '已格式化', 'ok')
  }

  const minify = () => {
    const result = parseJson(value)
    if (!result.ok) {
      setNotice({ text: result.error, kind: 'error' })
      return
    }
    setEditorValue(JSON.stringify(result.value), '已压缩为单行', 'ok')
  }

  const validate = () => {
    if (!value.trim()) {
      setNotice({ text: '请输入 JSON', kind: 'warn' })
      return
    }
    setNotice({
      text: parsed.ok ? `JSON 有效 · ${stats.nodes} 节点 · 深度 ${stats.depth}` : parsed.error,
      kind: parsed.ok ? 'ok' : 'error'
    })
  }

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        setNotice({ text: '剪贴板没有文本', kind: 'warn' })
        return
      }
      const converted = convertLooseText(text)
      setEditorValue(converted.text, converted.message, converted.kind)
    } catch (error) {
      setNotice({ text: errorMessage(error), kind: 'error' })
    }
  }

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice({ text: '已复制编辑器内容', kind: 'ok' })
    } catch (error) {
      setNotice({ text: errorMessage(error), kind: 'error' })
    }
  }

  const download = () => {
    const blob = new Blob([value], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'data.json'
    link.click()
    URL.revokeObjectURL(url)
    setNotice({ text: '已下载 data.json', kind: 'ok' })
  }

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    const converted = convertLooseText(text)
    setEditorValue(converted.text, file.name + ' · ' + converted.message, converted.kind)
  }

  const foldAll = () => editorRef.current?.trigger('toolbar', 'editor.foldAll', null)
  const unfoldAll = () => editorRef.current?.trigger('toolbar', 'editor.unfoldAll', null)

  const copyFiltered = async () => {
    if (!filterResult.ok) return
    await navigator.clipboard.writeText(filterResult.text)
    setNotice({ text: '已复制过滤结果', kind: 'ok' })
  }

  return (
    <main className="shell">
      <section className={clsx('editor-frame', filterResult.active && 'editor-frame-split')}>
        <div className="editor-pane editor-pane-source">
          {!value && <div className="editor-placeholder">URL Params、XML、YAML 粘贴自动转为 JSON</div>}
          <Editor
            height="100%"
            defaultLanguage="json"
            value={value}
            onChange={(next) => setValue(next ?? '')}
            onMount={onMount}
            theme="vs-dark"
            options={sourceEditorOptions}
          />
        </div>

        {filterResult.active && (
          <div className={clsx('editor-pane', 'editor-pane-result', !filterResult.ok && 'editor-pane-error')}>
            <Editor
              height="100%"
              language={filterResult.ok ? 'json' : 'plaintext'}
              value={filterResult.text}
              theme="vs-dark"
              options={previewEditorOptions}
            />
          </div>
        )}
      </section>

      <footer className="bottombar">
        <div className="filter-prefix">this</div>
        <div className="filter">
          <Search size={14} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder='JS 过滤，示例  ".key.subkey"、"[0][1]"、".map(x=>x.val)"'
            spellCheck={false}
          />
        </div>
        <div className={clsx('result-chip', filterResult.active && !filterResult.ok && 'result-chip-error')} title={filterResult.active ? filterResult.text : notice.text}>
          {filterResult.active ? (filterResult.ok ? '已过滤' : filterResult.text) : notice.text}
        </div>
        <ToolbarButton title="粘贴/自动转换" onClick={paste} icon={<Clipboard size={16} />} />
        <ToolbarButton title="格式化" onClick={format} icon={<AlignJustify size={16} />} />
        <ToolbarButton title="压缩" onClick={minify} icon={<Minimize2 size={15} />} />
        <ToolbarButton title="折叠全部" onClick={foldAll} icon={<ChevronUp size={16} />} />
        <ToolbarButton title="展开全部" onClick={unfoldAll} icon={<ChevronDown size={16} />} />
        <ToolbarButton
          title={wrap ? '关闭换行' : '开启换行'}
          onClick={() => setWrap((current) => !current)}
          icon={<WrapText size={16} />}
          active={wrap}
        />
        <ToolbarButton title="复制" onClick={copyContent} icon={<Copy size={16} />} />
        <ToolbarButton title="复制过滤结果" onClick={copyFiltered} icon={<Braces size={16} />} disabled={!filterResult.ok} />
        <ToolbarButton title="校验" onClick={validate} icon={<ShieldCheck size={16} />} />
        <label className="icon-button" title="打开文件">
          <Upload size={16} />
          <input type="file" accept=".json,.txt,.xml,.yaml,.yml" onChange={loadFile} />
        </label>
        <ToolbarButton title="下载 JSON" onClick={download} icon={<Download size={16} />} disabled={!value} />
        <ToolbarButton title="清空" onClick={() => setEditorValue('', '已清空', 'idle')} icon={<Eraser size={16} />} />
      </footer>

      <aside className="statusline">
        <span className={clsx('notice', `notice-${notice.kind}`)}>
          <Sparkles size={13} />
          {notice.text}
        </span>
        <span>{stats.lines} 行</span>
        <span>{formatBytes(stats.size)}</span>
        <span>{stats.type}</span>
        <span>节点 {stats.nodes}</span>
        <span>缩进 {indent}</span>
        <button className="stepper" onClick={() => setIndent((current) => (current === 2 ? 4 : 2))}>
          {indent === 2 ? '2 空格' : '4 空格'}
        </button>
      </aside>
    </main>
  )
}

function ToolbarButton({
  title,
  onClick,
  icon,
  active,
  disabled
}: {
  title: string
  onClick: () => void
  icon: React.ReactNode
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={clsx('icon-button', active && 'icon-button-active')}
      title={title}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {icon}
    </button>
  )
}

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string }

function parseJson(text: string): ParseResult {
  if (!text.trim()) return { ok: false, error: '空白内容' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

function jsonStats(text: string, parsed: ParseResult): JsonStats {
  if (!parsed.ok) {
    return {
      valid: false,
      type: 'unknown',
      size: new Blob([text]).size,
      lines: Math.max(1, text.split(/\r?\n/).length),
      nodes: 0,
      depth: 0,
      error: parsed.error
    }
  }
  return {
    valid: true,
    type: valueType(parsed.value),
    size: new Blob([text]).size,
    lines: Math.max(1, text.split(/\r?\n/).length),
    nodes: countNodes(parsed.value),
    depth: maxDepth(parsed.value)
  }
}

function convertLooseText(text: string): { text: string; message: string; kind: NoticeKind } {
  const trimmed = text.trim()
  if (!trimmed) return { text: '', message: '剪贴板为空', kind: 'warn' }
  if (parseJson(trimmed).ok) return { text: trimmed, message: '已粘贴 JSON', kind: 'ok' }
  if (looksLikeUrlParams(trimmed)) {
    return {
      text: JSON.stringify(urlParamsToJson(trimmed), null, 2),
      message: 'URL Params 已转 JSON',
      kind: 'ok'
    }
  }
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return {
      text: JSON.stringify(xmlToJson(trimmed), null, 2),
      message: 'XML 已转 JSON',
      kind: 'ok'
    }
  }
  if (looksLikeYaml(trimmed)) {
    return {
      text: JSON.stringify(yamlLikeToJson(trimmed), null, 2),
      message: 'YAML 已转 JSON',
      kind: 'ok'
    }
  }
  return { text: trimmed, message: '已按文本粘贴', kind: 'warn' }
}

function looksLikeUrlParams(text: string): boolean {
  return /^[^=\s&?]+=[\s\S]*(&[^=\s&?]+=[\s\S]*)*$/.test(text.replace(/^\?/, ''))
}

function urlParamsToJson(text: string): Record<string, unknown> {
  const params = new URLSearchParams(text.replace(/^\?/, ''))
  const out: Record<string, unknown> = {}
  for (const [key, value] of params.entries()) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      const current = out[key]
      out[key] = Array.isArray(current) ? [...current, coerceScalar(value)] : [current, coerceScalar(value)]
    } else {
      out[key] = coerceScalar(value)
    }
  }
  return out
}

function looksLikeYaml(text: string): boolean {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .some((line) => /^\s*[\w.-]+\s*:\s+/.test(line))
}

function yamlLikeToJson(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -1, value: root }]
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const match = raw.match(/^(\s*)([^:#]+):\s*(.*)$/)
    if (!match) continue
    const indentLevel = match[1].length
    const key = match[2].trim()
    const rawValue = match[3].trim()
    while (stack.length > 1 && indentLevel <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].value
    if (!rawValue) {
      const child: Record<string, unknown> = {}
      parent[key] = child
      stack.push({ indent: indentLevel, value: child })
    } else {
      parent[key] = coerceScalar(rawValue.replace(/^['"]|['"]$/g, ''))
    }
  }
  return root
}

function xmlToJson(text: string): unknown {
  const documentValue = new DOMParser().parseFromString(text, 'application/xml')
  const parserError = documentValue.querySelector('parsererror')
  if (parserError) return { error: parserError.textContent?.trim() || 'XML parse error' }
  return elementToJson(documentValue.documentElement)
}

function elementToJson(element: Element): unknown {
  const out: Record<string, unknown> = {}
  if (element.attributes.length) {
    out.$attrs = Object.fromEntries([...element.attributes].map((attr) => [attr.name, attr.value]))
  }
  const children = [...element.children]
  const text = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .join(' ')
  if (!children.length) return text || out
  for (const child of children) {
    const value = elementToJson(child)
    const current = out[child.tagName]
    out[child.tagName] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value]
  }
  if (text) out.$text = text
  return { [element.tagName]: out }
}

function queryJson(value: unknown, expression: string): QueryResult {
  try {
    if (expression.startsWith('.')) return pathQuery(value, expression)
    if (expression.startsWith('[')) return pathQuery(value, expression)
    const fn = new Function('value', `const thisValue = value; return thisValue${expression}`)
    return { ok: true, value: fn(value) }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

function pathQuery(value: unknown, expression: string): QueryResult {
  const path = expression
    .replace(/^\./, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let current: unknown = value
  for (const part of path) {
    if (current == null) return { ok: false, error: '路径不存在' }
    if (!isIndexableValue(current)) return { ok: false, error: `无法继续访问 ${part}` }
    current = (current as Record<string, unknown>)[part]
    if (current === undefined) return { ok: false, error: '路径不存在' }
  }
  return { ok: true, value: current }
}

function isIndexableValue(value: unknown): value is Record<string, unknown> | unknown[] {
  return (typeof value === 'object' && value !== null) || typeof value === 'string'
}

function formatJsonValue(value: unknown, indent: number): string {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, null, indent)
}

function coerceScalar(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  return value
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function countNodes(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce((sum, item) => sum + countNodes(item), 0)
  if (value && typeof value === 'object') {
    return 1 + Object.values(value).reduce((sum, item) => sum + countNodes(item), 0)
  }
  return 1
}

function maxDepth(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(maxDepth))
  if (value && typeof value === 'object') return 1 + Math.max(0, ...Object.values(value).map(maxDepth))
  return 1
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
