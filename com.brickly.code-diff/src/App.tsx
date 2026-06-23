import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import clsx from 'clsx'
import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Braces,
  Clipboard,
  Copy,
  Eraser,
  FileText,
  Moon,
  RotateCcw,
  Rows3,
  SearchCode,
  Sun,
  WrapText
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { IDisposable, editor } from 'monaco-editor'

const SAMPLE_LEFT = `{
  "name": "brickly",
  "version": "0.1.0",
  "features": [
    "clipboard",
    "json"
  ],
  "settings": {
    "theme": "dark",
    "autoSave": false
  }
}`

const SAMPLE_RIGHT = `{
  "name": "brickly",
  "version": "0.2.0",
  "features": [
    "clipboard",
    "json",
    "diff"
  ],
  "settings": {
    "theme": "dark",
    "autoSave": true
  }
}`

const LANGUAGE_OPTIONS = [
  { value: 'plaintext', label: 'Text' },
  { value: 'json', label: 'JSON' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'php', label: 'PHP' },
  { value: 'shell', label: 'Shell' }
] as const

type DiffMode = 'side-by-side' | 'inline'
type ThemeMode = 'dark' | 'light'
type NoticeKind = 'idle' | 'ok' | 'warn' | 'error'

type Notice = {
  text: string
  kind: NoticeKind
}

type DiffStats = {
  changedBlocks: number
  addedLines: number
  removedLines: number
  modifiedLines: number
}

type DiffRecord = {
  id: string
  title: string
  createdAt: string
  language: string
  left: string
  right: string
  stats: DiffStats
}

type DiffActions = {
  formatBoth: () => void
  clearAll: () => void
  previousDiff: () => void
  nextDiff: () => void
  saveRecord: () => void
}

export function App() {
  const [left, setLeft] = useState(SAMPLE_LEFT)
  const [right, setRight] = useState(SAMPLE_RIGHT)
  const [language, setLanguage] = useState<(typeof LANGUAGE_OPTIONS)[number]['value']>('json')
  const [diffMode, setDiffMode] = useState<DiffMode>('side-by-side')
  const [theme, setTheme] = useState<ThemeMode>('dark')
  const [wrap, setWrap] = useState(false)
  const [stats, setStats] = useState<DiffStats>(() => createEmptyStats())
  const [records, setRecords] = useState<DiffRecord[]>([])
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>({ text: 'Ctrl+Shift+E 格式化 · Ctrl+S 添加记录', kind: 'idle' })
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const disposablesRef = useRef<IDisposable[]>([])
  const actionsRef = useRef<DiffActions>({
    formatBoth: () => undefined,
    clearAll: () => undefined,
    previousDiff: () => undefined,
    nextDiff: () => undefined,
    saveRecord: () => undefined
  })

  const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs'
  const diffOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      renderSideBySide: diffMode === 'side-by-side',
      originalEditable: true,
      readOnly: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 21,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: wrap ? 'on' : 'off',
      glyphMargin: false,
      overviewRulerBorder: false,
      renderOverviewRuler: true,
      renderLineHighlight: 'line',
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: true },
      diffWordWrap: wrap ? 'on' : 'off',
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      useInlineViewWhenSpaceIsLimited: false
    }),
    [diffMode, wrap]
  )

  const updateStats = useCallback(() => {
    const editorValue = diffEditorRef.current
    if (!editorValue) return
    setStats(computeStats(editorValue.getLineChanges()))
  }, [])

  const onMount: DiffOnMount = useCallback(
    (instance, monaco) => {
      diffEditorRef.current = instance
      disposablesRef.current.forEach((disposable) => disposable.dispose())
      const leftEditor = instance.getOriginalEditor()
      const rightEditor = instance.getModifiedEditor()

      const refreshContent = () => {
        setLeft(leftEditor.getValue())
        setRight(rightEditor.getValue())
      }

      const formatShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE
      const clearShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD
      const previousShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyCode.LeftArrow
      const nextShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow
      const saveShortcut = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS

      const registerShortcut = (keybinding: number, handler: () => void) => {
        instance.addCommand(keybinding, handler)
        leftEditor.addCommand(keybinding, handler)
        rightEditor.addCommand(keybinding, handler)
      }

      registerShortcut(formatShortcut, () => actionsRef.current.formatBoth())
      registerShortcut(clearShortcut, () => actionsRef.current.clearAll())
      registerShortcut(previousShortcut, () => actionsRef.current.previousDiff())
      registerShortcut(nextShortcut, () => actionsRef.current.nextDiff())
      registerShortcut(saveShortcut, () => actionsRef.current.saveRecord())

      disposablesRef.current = [
        leftEditor.onDidChangeModelContent(refreshContent),
        rightEditor.onDidChangeModelContent(refreshContent),
        instance.onDidUpdateDiff(updateStats),
        instance.onDidChangeModel(updateStats)
      ]
      instance.revealFirstDiff()
      updateStats()
    },
    [updateStats]
  )

  const replaceContent = useCallback((nextLeft: string, nextRight: string, message: string, kind: NoticeKind = 'ok') => {
    setLeft(nextLeft)
    setRight(nextRight)
    diffEditorRef.current?.getOriginalEditor().setValue(nextLeft)
    diffEditorRef.current?.getModifiedEditor().setValue(nextRight)
    setNotice({ text: message, kind })
    window.setTimeout(updateStats, 50)
  }, [updateStats])

  const formatBoth = useCallback(() => {
    const leftResult = formatText(left, language)
    const rightResult = formatText(right, language)
    replaceContent(leftResult.text, rightResult.text, leftResult.ok && rightResult.ok ? '已格式化两侧内容' : '部分内容无法格式化', leftResult.ok && rightResult.ok ? 'ok' : 'warn')
  }, [language, left, replaceContent, right])

  const sortJson = useCallback(() => {
    if (language !== 'json') {
      setNotice({ text: 'JSON 重排只适用于 JSON 语言', kind: 'warn' })
      return
    }
    const leftResult = sortJsonText(left)
    const rightResult = sortJsonText(right)
    replaceContent(leftResult.text, rightResult.text, leftResult.ok && rightResult.ok ? 'JSON 已按 key 重排' : 'JSON 解析失败，无法重排', leftResult.ok && rightResult.ok ? 'ok' : 'error')
  }, [language, left, replaceContent, right])

  const clearAll = useCallback(() => {
    replaceContent('', '', '已清空内容', 'idle')
    setActiveRecordId(null)
  }, [replaceContent])

  const resetSample = useCallback(() => {
    replaceContent(SAMPLE_LEFT, SAMPLE_RIGHT, '已恢复示例', 'idle')
    setActiveRecordId(null)
  }, [replaceContent])

  const goToDiff = useCallback((direction: 'next' | 'previous') => {
    const editorValue = diffEditorRef.current
    if (!editorValue) return
    editorValue.goToDiff(direction)
    setNotice({ text: direction === 'next' ? '下一处差异' : '上一处差异', kind: 'idle' })
  }, [])

  const copyRight = useCallback(async () => {
    await navigator.clipboard.writeText(right)
    setNotice({ text: '已复制右侧内容', kind: 'ok' })
  }, [right])

  const pasteToLeft = useCallback(async () => {
    const text = await navigator.clipboard.readText()
    replaceContent(text, right, '已粘贴到左侧', 'ok')
  }, [replaceContent, right])

  const pasteToRight = useCallback(async () => {
    const text = await navigator.clipboard.readText()
    replaceContent(left, text, '已粘贴到右侧', 'ok')
  }, [left, replaceContent])

  const saveRecord = useCallback(() => {
    const now = new Date()
    const record: DiffRecord = {
      id: `${now.getTime()}`,
      title: `${language.toUpperCase()} 对比 · ${formatTime(now)}`,
      createdAt: now.toISOString(),
      language,
      left,
      right,
      stats
    }
    setRecords((current) => [record, ...current].slice(0, 12))
    setActiveRecordId(record.id)
    setNotice({ text: '已添加对比记录', kind: 'ok' })
  }, [language, left, right, stats])

  actionsRef.current = {
    formatBoth,
    clearAll,
    previousDiff: () => goToDiff('previous'),
    nextDiff: () => goToDiff('next'),
    saveRecord
  }

  const openRecord = (record: DiffRecord) => {
    setLanguage(record.language as (typeof LANGUAGE_OPTIONS)[number]['value'])
    replaceContent(record.left, record.right, '已打开历史记录', 'idle')
    setActiveRecordId(record.id)
  }

  return (
    <main className={clsx('shell', theme === 'light' && 'shell-light')}>
      <section className="topbar">
        <div className="brand">
          <SearchCode size={19} />
          <div>
            <strong>代码对比</strong>
            <span>Monaco Diff Editor</span>
          </div>
        </div>

        <div className="controls">
          <select value={language} onChange={(event) => setLanguage(event.target.value as (typeof LANGUAGE_OPTIONS)[number]['value'])} title="语言">
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SegmentedControl
            value={diffMode}
            options={[
              { value: 'side-by-side', label: '并排' },
              { value: 'inline', label: '行内' }
            ]}
            onChange={(next) => setDiffMode(next as DiffMode)}
          />
          <ToolbarButton title={wrap ? '关闭换行' : '开启换行'} active={wrap} onClick={() => setWrap((current) => !current)} icon={<WrapText size={16} />} />
          <ToolbarButton title={theme === 'dark' ? '浅色主题' : '深色主题'} onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))} icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} />
        </div>
      </section>

      <section className="statsbar">
        <Metric label="差异块" value={stats.changedBlocks} tone="neutral" />
        <Metric label="新增" value={stats.addedLines} tone="add" />
        <Metric label="删除" value={stats.removedLines} tone="remove" />
        <Metric label="修改" value={stats.modifiedLines} tone="modify" />
        <span className={clsx('notice', `notice-${notice.kind}`)}>{notice.text}</span>
      </section>

      <section className="workspace">
        <div className="diff-shell">
          <div className="pane-labels">
            <span>原始内容</span>
            <span>对比内容</span>
          </div>
          <DiffEditor
            height="100%"
            original={left}
            modified={right}
            language={language}
            theme={monacoTheme}
            options={diffOptions}
            onMount={onMount}
          />
        </div>

        <aside className="history">
          <div className="history-header">
            <span>对比记录</span>
            <small>{records.length}/12</small>
          </div>
          {records.length === 0 ? (
            <div className="empty-records">Ctrl+S 保存当前对比</div>
          ) : (
            records.map((record) => (
              <button
                key={record.id}
                className={clsx('record', activeRecordId === record.id && 'record-active')}
                onClick={() => openRecord(record)}
                type="button"
              >
                <strong>{record.title}</strong>
                <span>
                  {record.stats.changedBlocks} 块 · +{record.stats.addedLines} · -{record.stats.removedLines}
                </span>
              </button>
            ))
          )}
        </aside>
      </section>

      <footer className="toolbar">
        <ToolbarButton title="粘贴到左侧" onClick={pasteToLeft} icon={<Clipboard size={16} />} label="左贴" />
        <ToolbarButton title="粘贴到右侧" onClick={pasteToRight} icon={<Clipboard size={16} />} label="右贴" />
        <ToolbarButton title="格式化 Ctrl+Shift+E" onClick={formatBoth} icon={<AlignJustify size={16} />} />
        <ToolbarButton title="JSON key 重排" onClick={sortJson} icon={<Braces size={16} />} disabled={language !== 'json'} />
        <ToolbarButton title="上一处差异 Ctrl+←" onClick={() => goToDiff('previous')} icon={<ArrowUp size={16} />} />
        <ToolbarButton title="下一处差异 Ctrl+→" onClick={() => goToDiff('next')} icon={<ArrowDown size={16} />} />
        <ToolbarButton title="行内/并排切换" onClick={() => setDiffMode((current) => (current === 'side-by-side' ? 'inline' : 'side-by-side'))} icon={<Rows3 size={16} />} />
        <ToolbarButton title="复制右侧内容" onClick={copyRight} icon={<Copy size={16} />} />
        <ToolbarButton title="添加对比记录 Ctrl+S" onClick={saveRecord} icon={<BookmarkPlus size={16} />} />
        <ToolbarButton title="恢复示例" onClick={resetSample} icon={<RotateCcw size={16} />} />
        <ToolbarButton title="清除内容 Ctrl+Shift+D" onClick={clearAll} icon={<Eraser size={16} />} />
        <div className="shortcut-text">
          Ctrl+Shift+D 清空 · Ctrl+Shift+E 格式化 · Ctrl+←/→ 差异定位 · Ctrl+S 记录
        </div>
      </footer>
    </main>
  )
}

function ToolbarButton({
  title,
  onClick,
  icon,
  label,
  active,
  disabled
}: {
  title: string
  onClick: () => void
  icon: React.ReactNode
  label?: string
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button className={clsx('tool-button', active && 'tool-button-active')} title={title} onClick={onClick} disabled={disabled} type="button">
      {icon}
      {label && <span>{label}</span>}
    </button>
  )
}

function SegmentedControl({
  value,
  options,
  onChange
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} className={clsx(value === option.value && 'segmented-active')} onClick={() => onChange(option.value)} type="button">
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'add' | 'remove' | 'modify' }) {
  return (
    <div className={clsx('metric', `metric-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function createEmptyStats(): DiffStats {
  return {
    changedBlocks: 0,
    addedLines: 0,
    removedLines: 0,
    modifiedLines: 0
  }
}

function computeStats(changes: editor.ILineChange[] | null): DiffStats {
  if (!changes) return createEmptyStats()
  return changes.reduce(
    (next, change) => {
      const originalCount = Math.max(0, change.originalEndLineNumber - change.originalStartLineNumber + 1)
      const modifiedCount = Math.max(0, change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1)
      const modifiedLines = Math.min(originalCount, modifiedCount)
      next.changedBlocks += 1
      next.removedLines += Math.max(0, originalCount - modifiedLines)
      next.addedLines += Math.max(0, modifiedCount - modifiedLines)
      next.modifiedLines += modifiedLines
      return next
    },
    createEmptyStats()
  )
}

function formatText(text: string, language: string): { ok: boolean; text: string } {
  if (!text.trim()) return { ok: true, text }
  if (language === 'json') {
    try {
      return { ok: true, text: JSON.stringify(JSON.parse(text), null, 2) }
    } catch {
      return { ok: false, text }
    }
  }
  return { ok: true, text: normalizeIndentation(text) }
}

function sortJsonText(text: string): { ok: boolean; text: string } {
  try {
    return { ok: true, text: JSON.stringify(sortJsonValue(JSON.parse(text)), null, 2) }
  } catch {
    return { ok: false, text }
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, child]) => [key, sortJsonValue(child)])
    )
  }
  return value
}

function normalizeIndentation(text: string): string {
  const lines = text.replace(/\t/g, '  ').split(/\r?\n/)
  const nonEmpty = lines.filter((line) => line.trim())
  const minIndent = Math.min(...nonEmpty.map((line) => line.match(/^\s*/)?.[0].length ?? 0))
  return lines.map((line) => line.slice(minIndent)).join('\n').trim()
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}
