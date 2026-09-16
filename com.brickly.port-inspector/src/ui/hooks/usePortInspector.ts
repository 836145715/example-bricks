import { useCallback, useEffect, useMemo, useState } from 'react'
import { getProcessDetails, killProcess, listPorts, lookupPort } from '../brickly'
import type {
  KillProcessResult,
  Mode,
  PortProcessRow,
  PortQueryResult,
  ProcessDetails,
  ProtocolFilter,
  SortField,
  SortOrder
} from '../types'

export interface Notice {
  kind: 'idle' | 'ok' | 'error'
  text: string
}

export interface ConfirmTarget {
  pid: number
  processName?: string | null
}

function normalizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return String(error)
}

function isValidPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

function uniquePidCount(rows: PortProcessRow[]) {
  return new Set(rows.map((row) => row.pid).filter((pid): pid is number => Number.isInteger(pid))).size
}

/**
 * 端口检测与进程管理状态 Hook
 */
export function usePortInspector() {
  const [mode, setMode] = useState<Mode>('list')
  const [port, setPort] = useState('')
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState<ProtocolFilter>('all')
  const [includeEstablished, setIncludeEstablished] = useState(true)
  const [busy, setBusy] = useState(false)
  const [killingPid, setKillingPid] = useState<number | null>(null)
  const [copiedPid, setCopiedPid] = useState<number | null>(null)
  const [result, setResult] = useState<PortQueryResult | null>(null)
  const [lastKill, setLastKill] = useState<KillProcessResult | null>(null)

  // 进程详情侧边抽屉状态
  const [details, setDetails] = useState<ProcessDetails | null>(null)
  const [detailsLoadingPid, setDetailsLoadingPid] = useState<number | null>(null)
  const [inspectOpen, setInspectOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [inspectError, setInspectError] = useState<string | null>(null)

  // 弹窗确认强杀的目标 PID
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)

  // 提示信息
  const [notice, setNotice] = useState<Notice>({ kind: 'idle', text: '输入端口后点击「扫描」开始排查' })

  // 排序状态
  const [sortField, setSortField] = useState<SortField>('localPort')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const selectedPort = Number(port)
  const canLookup = isValidPort(selectedPort)
  const rawRows = result?.rows ?? []

  // 客户端实时即时筛选与排序（让界面交互响应极速）
  const processedRows = useMemo(() => {
    let list = [...rawRows]

    // 模糊筛选（PID/端口/进程名/协议）
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((row) => {
        const portStr = String(row.localPort)
        const pidStr = row.pid !== null ? String(row.pid) : ''
        const nameStr = (row.processName || '').toLowerCase()
        const pathStr = (row.executablePath || '').toLowerCase()
        const stateStr = (row.state || '').toLowerCase()
        const protoStr = row.protocol.toLowerCase()
        return (
          portStr.includes(q) ||
          pidStr.includes(q) ||
          nameStr.includes(q) ||
          pathStr.includes(q) ||
          stateStr.includes(q) ||
          protoStr.includes(q)
        )
      })
    }

    // 排序逻辑
    list.sort((a, b) => {
      let valA: string | number = ''
      let valB: string | number = ''

      if (sortField === 'localPort') {
        valA = a.localPort
        valB = b.localPort
      } else if (sortField === 'pid') {
        valA = a.pid ?? 999999
        valB = b.pid ?? 999999
      } else if (sortField === 'processName') {
        valA = (a.processName || 'zzz').toLowerCase()
        valB = (b.processName || 'zzz').toLowerCase()
      } else if (sortField === 'protocol') {
        valA = a.protocol
        valB = b.protocol
      } else if (sortField === 'state') {
        valA = a.state
        valB = b.state
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [rawRows, query, sortField, sortOrder])

  const summary = useMemo(
    () => ({
      records: processedRows.length,
      processes: uniquePidCount(processedRows),
      tcp: processedRows.filter((row) => row.protocol === 'tcp').length,
      udp: processedRows.filter((row) => row.protocol === 'udp').length
    }),
    [processedRows]
  )

  const toggleSort = useCallback((field: SortField) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortOrder((ord) => (ord === 'asc' ? 'desc' : 'asc'))
        return field
      }
      setSortOrder('asc')
      return field
    })
  }, [])

  const runTask = useCallback(
    async (task: () => Promise<PortQueryResult>, successText: (data: PortQueryResult) => string) => {
      setBusy(true)
      setLastKill(null)
      try {
        const data = await task()
        setResult(data)
        setNotice({
          kind: data.rows.length ? 'ok' : 'idle',
          text: successText(data)
        })
      } catch (error) {
        setNotice({ kind: 'error', text: normalizeError(error) })
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const runLookup = useCallback(
    async (targetPort?: number) => {
      const p = targetPort ?? selectedPort
      if (!isValidPort(p)) {
        setNotice({ kind: 'error', text: '端口号须为 1～65535 的整数' })
        return
      }
      if (targetPort !== undefined) {
        setPort(String(targetPort))
      }
      await runTask(
        () => lookupPort(p, protocol),
        (data) =>
          data.rows.length
            ? `端口 ${p} 被 ${uniquePidCount(data.rows)} 个进程占用（${data.rows.length} 条连接）`
            : `端口 ${p} 当前空闲`
      )
    },
    [selectedPort, protocol, runTask]
  )

  const runList = useCallback(async () => {
    await runTask(
      () =>
        listPorts({
          query,
          protocol,
          includeEstablished,
          limit: 300
        }),
      (data) => (data.rows.length ? `筛选得到 ${data.rows.length} 条记录` : '没有匹配的连接')
    )
  }, [query, protocol, includeEstablished, runTask])

  const refresh = useCallback(async () => {
    if (mode === 'port') {
      await runLookup()
    } else {
      await runList()
    }
  }, [mode, runLookup, runList])

  const copyPid = useCallback(async (pid: number | null) => {
    if (!pid) return
    try {
      await navigator.clipboard?.writeText(String(pid))
      setCopiedPid(pid)
      setNotice({ kind: 'ok', text: `已复制 PID ${pid}` })
      setTimeout(() => setCopiedPid(null), 1500)
    } catch {
      setNotice({ kind: 'error', text: '复制到剪贴板失败' })
    }
  }, [])

  const copyText = useCallback(async (value: string | null, label: string) => {
    if (!value) return
    try {
      await navigator.clipboard?.writeText(value)
      setNotice({ kind: 'ok', text: `已复制${label}` })
    } catch {
      setNotice({ kind: 'error', text: `复制${label}失败` })
    }
  }, [])

  const openInspect = useCallback(async (row: PortProcessRow, key: string) => {
    if (!row.pid) {
      setNotice({ kind: 'error', text: '该连接没有 PID，无法查看详情' })
      return
    }
    setSelectedKey(key)
    setInspectOpen(true)
    setDetails(null)
    setInspectError(null)
    setDetailsLoadingPid(row.pid)
    try {
      const data = await getProcessDetails(row.pid)
      setDetails(data)
      setNotice({ kind: 'ok', text: `已加载进程详情 · PID ${row.pid}` })
    } catch (error) {
      const msg = normalizeError(error)
      setInspectError(msg)
      setNotice({ kind: 'error', text: msg })
    } finally {
      setDetailsLoadingPid(null)
    }
  }, [])

  const closeInspect = useCallback(() => {
    setInspectOpen(false)
    setSelectedKey(null)
    setInspectError(null)
  }, [])

  // 触发强杀弹窗对话框
  const promptKill = useCallback((pid: number, processName?: string | null) => {
    setConfirmTarget({ pid, processName })
  }, [])

  // 取消强杀
  const cancelKill = useCallback(() => {
    setConfirmTarget(null)
  }, [])

  // 执行结束进程（force 由确认弹窗传入；Windows 上始终为 true）
  const executeKill = useCallback(
    async (force: boolean) => {
      if (!confirmTarget) return
      const { pid } = confirmTarget
      setKillingPid(pid)
      try {
        const killed = await killProcess(pid, force)
        setLastKill(killed)
        setNotice({
          kind: 'ok',
          text: killed.alreadyExited ? `进程已不存在 · PID ${pid}` : `已成功结束进程 · PID ${pid}`
        })
        if (details?.pid === pid) {
          closeInspect()
          setDetails(null)
        }
        setConfirmTarget(null)
        await refresh()
      } catch (error) {
        setNotice({ kind: 'error', text: normalizeError(error) })
      } finally {
        setKillingPid(null)
      }
    },
    [confirmTarget, details?.pid, closeInspect, refresh]
  )

  // 初始化：默认「列全部」
  useEffect(() => {
    void runList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    mode,
    setMode,
    port,
    setPort,
    query,
    setQuery,
    protocol,
    setProtocol,
    includeEstablished,
    setIncludeEstablished,
    busy,
    killingPid,
    copiedPid,
    result,
    lastKill,
    details,
    detailsLoadingPid,
    inspectOpen,
    selectedKey,
    inspectError,
    notice,
    summary,
    processedRows,
    sortField,
    sortOrder,
    canLookup,
    confirmTarget,
    toggleSort,
    runLookup,
    runList,
    refresh,
    copyPid,
    copyText,
    openInspect,
    closeInspect,
    promptKill,
    cancelKill,
    executeKill
  }
}
