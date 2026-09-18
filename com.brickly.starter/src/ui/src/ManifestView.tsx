import { useEffect, useRef } from 'react'
import { monaco } from './monaco-setup'

/** 生成物 manifest 的 Monaco 只读预览；JSON 诊断由 vendored schema 驱动。 */
export function ManifestView({ manifest }: { manifest: unknown }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const editor = monaco.editor.create(hostRef.current, {
      value: '',
      language: 'json',
      readOnly: true,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: 12,
      theme: 'vs'
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
