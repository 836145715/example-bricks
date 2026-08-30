import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import type { StreamWriter } from '../brickly'
import { classifyPaste } from '../lib/local-paths'
import { isCopyKey, isPasteKey } from '../lib/terminal-keys'
import type { SessionStatus } from '../types'

async function readClipboardText(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()) ?? ''
  } catch {
    return ''
  }
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    document.execCommand('copy')
  }
}

export function TerminalPane({
  sessionId,
  status,
  active,
  message,
  onReady,
  onInput,
  onResize,
  onLocalPathPaste
}: {
  sessionId: string
  status: SessionStatus
  active: boolean
  message?: string
  onReady: (api: { write: StreamWriter; cols: number; rows: number }) => void
  onInput?: (data: string) => void
  onResize?: (cols: number, rows: number) => void
  onLocalPathPaste?: (path: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const bufferRef = useRef('')
  const flushTimer = useRef<number | null>(null)
  const statusRef = useRef(status)
  const pathPasteRef = useRef(onLocalPathPaste)
  const inputRef = useRef(onInput)
  const resizeRef = useRef(onResize)
  statusRef.current = status
  pathPasteRef.current = onLocalPathPaste
  inputRef.current = onInput
  resizeRef.current = onResize

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0b0c0f',
        foreground: '#d7dde6',
        cursor: '#4a9eff',
        selectionBackground: '#4a9eff55',
        black: '#1c212b',
        red: '#e05d5d',
        green: '#3dba8b',
        yellow: '#d4a017',
        blue: '#4a9eff',
        magenta: '#c792ea',
        cyan: '#67d4d6',
        white: '#d7dde6'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    onReady({
      write: (bytes) => {
        term.write(bytes)
      },
      cols: term.cols,
      rows: term.rows
    })

    const flush = () => {
      const pending = bufferRef.current
      bufferRef.current = ''
      if (flushTimer.current) {
        window.clearTimeout(flushTimer.current)
        flushTimer.current = null
      }
      if (!pending || statusRef.current === 'closed' || statusRef.current === 'error') return
      inputRef.current?.(pending)
    }

    const disposable = term.onData((data) => {
      if (statusRef.current !== 'open' && statusRef.current !== 'connecting') return
      bufferRef.current += data
      if (!flushTimer.current) {
        flushTimer.current = window.setTimeout(flush, 16)
      }
    })

    const copySelection = () => {
      const text = term.getSelection()
      if (!text) return false
      void writeClipboardText(text)
      return true
    }

    const pasteClipboard = async () => {
      const text = await readClipboardText()
      if (!text) return
      const intent = classifyPaste({ text })
      if (intent.kind === 'path') {
        pathPasteRef.current?.(intent.path)
        return
      }
      term.paste(text)
    }

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (isCopyKey(event) && term.hasSelection()) {
        event.preventDefault()
        copySelection()
        return false
      }
      if (isPasteKey(event)) {
        event.preventDefault()
        void pasteClipboard()
        return false
      }
      return true
    })

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      if (term.hasSelection()) {
        copySelection()
        term.clearSelection()
        return
      }
      void pasteClipboard()
    }
    container.addEventListener('contextmenu', onContextMenu)

    const observer = new ResizeObserver(() => {
      fit.fit()
      if (statusRef.current === 'open') {
        resizeRef.current?.(term.cols, term.rows)
      }
    })
    observer.observe(container)

    return () => {
      disposable.dispose()
      container.removeEventListener('contextmenu', onContextMenu)
      observer.disconnect()
      flush()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      fitRef.current?.fit()
      const term = termRef.current
      if (term && status === 'open') {
        resizeRef.current?.(term.cols, term.rows)
      }
      term?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, sessionId, status])

  return (
    <div className="terminal-pane" data-active={active}>
      <div ref={containerRef} className="terminal-host" />
      {message ? <p className="session-message">{message}</p> : null}
    </div>
  )
}
