import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session, Status } from '../types'

const initial: Status = { running: false, port: 8899, proxyUrl: 'http://127.0.0.1:8899', total: 0, maxBodyBytes: 1048576, certificateFingerprint: '', pythonVersion: '-', systemProxy: false, systemProxyWarning: '' }

export function useHttpInspector() {
  const api = window.httpInspector
  const [status, setStatus] = useState(initial)
  const [rows, setRows] = useState<Session[]>([])
  const [detail, setDetail] = useState<Session | null>(null)
  const [query, setQuery] = useState('')
  const [port, setPort] = useState(8899)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!api) return
    try {
      const [nextStatus, result] = await Promise.all([api.invoke<Status>('status'), api.invoke<{ sessions: Session[] }>('list', { limit: 500 })])
      setStatus(nextStatus); setRows(result.sessions); setError('')
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
  }, [api])

  useEffect(() => { void refresh(); return api?.subscribe(() => void refresh()) }, [api, refresh])
  const filtered = useMemo(() => rows.filter(row => `${row.method} ${row.host} ${row.path} ${row.statusCode}`.toLowerCase().includes(query.toLowerCase())), [rows, query])
  const run = useCallback(async (command: string, input: Record<string, unknown> = {}) => { if (!api) return; setBusy(true); try { await api.invoke(command, input); await refresh() } catch (value) { setError(value instanceof Error ? value.message : String(value)) } finally { setBusy(false) } }, [api, refresh])
  const select = useCallback(async (id: string) => { if (!api) return; const result = await api.invoke<{ session: Session }>('detail', { id }); setDetail(result.session) }, [api])
  return { status, rows: filtered, detail, query, setQuery, port, setPort, busy, error, run, select }
}
