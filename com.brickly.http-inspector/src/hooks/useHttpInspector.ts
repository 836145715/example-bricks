import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BricklyStartedHandle, Session, Status } from '../types'

const CHANGE_EVENT = 'http-inspector:changed'
const initial: Status = {
  running: false,
  port: 8899,
  proxyUrl: 'http://127.0.0.1:8899',
  total: 0,
  maxBodyBytes: 1048576,
  certificateFingerprint: '',
  pythonVersion: '-',
  systemProxy: false,
  systemProxyWarning: ''
}

function requireBrickly() {
  if (!window.brickly?.invoke || !window.brickly.start) {
    throw new Error('window.brickly 不可用，请确认应用已在 Brickly 中打开')
  }
  return window.brickly
}

export function useHttpInspector() {
  const handleRef = useRef<BricklyStartedHandle | null>(null)
  const [status, setStatus] = useState(initial)
  const [rows, setRows] = useState<Session[]>([])
  const [detail, setDetail] = useState<Session | null>(null)
  const [query, setQuery] = useState('')
  const [port, setPort] = useState(8899)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const invoke = useCallback(async <T,>(commandId: string, input: Record<string, unknown> = {}) => {
    const handle = handleRef.current
    if (handle) return handle.invoke<T>(commandId, input)
    return requireBrickly().invoke<T>(commandId, input)
  }, [])

  const refresh = useCallback(async () => {
    if (!handleRef.current && !window.brickly?.invoke) return
    try {
      const [nextStatus, result] = await Promise.all([
        invoke<Status>('status'),
        invoke<{ sessions: Session[] }>('list', { limit: 500 })
      ])
      setStatus(nextStatus)
      setRows(result.sessions)
      setError('')
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    }
  }, [invoke])

  useEffect(() => {
    let alive = true
    let started: BricklyStartedHandle | null = null
    let unsubscribe: (() => void | Promise<void>) | undefined

    void (async () => {
      try {
        const brickly = requireBrickly()
        started = await brickly.start()
        if (!alive) {
          await started.dispose()
          return
        }
        handleRef.current = started
        try {
          unsubscribe = await brickly.events.subscribe(CHANGE_EVENT, () => {
            if (alive) void refresh()
          })
        } catch {
          // 事件总线不可用时仍可手动刷新
        }
        await refresh()
      } catch (value) {
        if (alive) setError(value instanceof Error ? value.message : String(value))
      }
    })()

    return () => {
      alive = false
      handleRef.current = null
      void unsubscribe?.()
      if (started) void started.dispose()
    }
  }, [refresh])

  const filtered = useMemo(
    () => rows.filter((row) => `${row.method} ${row.host} ${row.path} ${row.statusCode}`.toLowerCase().includes(query.toLowerCase())),
    [rows, query]
  )

  const run = useCallback(async (command: string, input: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      await invoke(command, input)
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setBusy(false)
    }
  }, [invoke, refresh])

  const select = useCallback(async (id: string) => {
    const result = await invoke<{ session: Session }>('detail', { id })
    setDetail(result.session)
  }, [invoke])

  return { status, rows: filtered, detail, query, setQuery, port, setPort, busy, error, run, select, invoke }
}
