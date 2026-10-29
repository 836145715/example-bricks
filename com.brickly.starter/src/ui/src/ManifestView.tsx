import { useEffect, useRef } from 'react'
import { monaco } from './monaco-setup'

const THEME = 'starter-dark'

function ensureTheme() {
  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1b2118',
      'editor.lineHighlightBackground': '#222a1e80',
      'editorLineNumber.foreground': '#6b7560',
      'editorLineNumber.activeForeground': '#a2ac93',
      'editorIndentGuide.background1': '#2b3426',
      'editorWidget.background': '#222a1e',
      'editorWidget.border': '#3f4c36',
      'scrollbarSlider.background': '#39422f80',
      'scrollbarSlider.hoverBackground': '#49543aa0'
    }
  })
}

/** 生成物 manifest 的 Monaco 只读预览；JSON 诊断由 vendored schema 驱动。 */
export function ManifestView({ manifest }: { manifest: unknown }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    ensureTheme()
    const editor = monaco.editor.create(hostRef.current, {
      value: '',
      language: 'json',
      readOnly: true,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: 12,
      fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
      padding: { top: 10, bottom: 10 },
      renderLineHighlight: 'all',
      theme: THEME
    })
    editorRef.current = editor
    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    editorRef.current?.setValue(JSON.stringify(manifest, null, 2))
  }, [manifest])

  return <div ref={hostRef} className="manifest-view" />
}
