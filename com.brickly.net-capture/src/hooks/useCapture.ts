import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaptureStatus, DriverMode, SessionDetail, SessionRow, SortField, SortOrder, StatusFilter } from '../types'
import { errorMessage } from '../utils/formatters'

const defaultCapabilities: CaptureStatus['capabilities'] = {
  platformKey: 'unknown',
  goos: 'unknown',
  goarch: 'unknown',
  systemProxy: false,
  installCert: false,
  driverModes: [
    { value: 'off', label: '关闭驱动', supported: true },
    { value: 'proxifier', label: 'Proxifier', supported: false, reason: '等待 runtime 上报平台能力' },
    { value: 'nfapi', label: 'NFAPI', supported: false, reason: '等待 runtime 上报平台能力' },
    { value: 'tun', label: 'TUN', supported: false, reason: '等待 runtime 上报平台能力' }
  ],
  notes: []
}

const initialStatus: CaptureStatus = {
  running: false,
  port: 2025,
  proxyUrl: 'http://127.0.0.1:2025',
  systemProxy: false,
  captureTcp: true,
  captureUdp: true,
  driverMode: 'off',
  maxBodyPreviewBytes: 4096,
  sunnyVersion: '-',
  goVersion: '-',
  total: 0,
  dropped: 0,
  queueDepth: 0,
  lastId: 0,
  capabilities: defaultCapabilities
}

function normalizeDriverMode(value: unknown): DriverMode {
  return value === 'proxifier' || value === 'nfapi' || value === 'tun' ? value : 'off'
}

function normalizeStatus(value: CaptureStatus): CaptureStatus {
  return {
    ...value,
    capabilities: {
      ...defaultCapabilities,
      ...value.capabilities,
      driverModes: value.capabilities?.driverModes?.length ? value.capabilities.driverModes : defaultCapabilities.driverModes,
      notes: value.capabilities?.notes ?? []
    }
  }
}

export function useCapture() {
  const [status, setStatus] = useState<CaptureStatus>(initialStatus)
  const [rows, setRows] = useState<SessionRow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  
  // 过滤与排序状态
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField, setSortField] = useState<SortField>('id')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // 抓包配置参数
  const [port, setPort] = useState(2025)
  const [captureTcp, setCaptureTcp] = useState(true)
  const [captureUdp, setCaptureUdp] = useState(true)
  const [driverMode, setDriverMode] = useState<DriverMode>('off')

  // 视图控制
  const [autoScroll, setAutoScroll] = useState(true)
  const [requestTab, setRequestTab] = useState('headers')
  const [responseTab, setResponseTab] = useState('headers')
  const [notice, setNotice] = useState('准备就绪')
  const [busy, setBusy] = useState(false)

  // 主题管理 ('dark' | 'light'，默认 'dark')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('net-capture-theme')
      return saved === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })

  const controlsHydratedRef = useRef(false)
  const lastIdRef = useRef(0)
  const listBusyRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const api = window.netCapture

  // 切换主题
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem('net-capture-theme', next)
      } catch {}
      return next
    })
  }, [])

  // 切换排序方式
  const changeSort = useCallback((field: SortField) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortOrder((currentOrder) => (currentOrder === 'asc' ? 'desc' : 'asc'))
        return field
      } else {
        setSortField(field)
        setSortOrder('asc')
        return field
      }
    })
  }, [])

  // 1. 过滤：按协议、搜索词、响应状态码/错误
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // 搜索词过滤
      if (query.trim()) {
        const q = query.toLowerCase()
        const urlStr = (row.url || '').toLowerCase()
        const hostStr = (row.host || '').toLowerCase()
        const pathStr = (row.path || '').toLowerCase()
        const processStr = (row.process || '').toLowerCase()
        const methodStr = (row.method || '').toLowerCase()
        const remoteStr = (row.remoteAddress || '').toLowerCase()
        const idStr = String(row.id)

        const match =
          urlStr.includes(q) ||
          hostStr.includes(q) ||
          pathStr.includes(q) ||
          processStr.includes(q) ||
          methodStr.includes(q) ||
          remoteStr.includes(q) ||
          idStr.includes(q)

        if (!match) return false
      }

      // 协议过滤
      if (protocol !== 'all') {
        if (row.protocol.toLowerCase() !== protocol.toLowerCase()) {
          return false
        }
      }

      // 状态过滤
      if (statusFilter !== 'all') {
        if (statusFilter === 'errors') {
          return !!row.error
        }
        const s = row.status
        if (!s) return false // 未决的请求或者纯连接错误不在此列
        if (statusFilter === 'success') return s >= 200 && s < 300
        if (statusFilter === 'redirect') return s >= 300 && s < 400
        if (statusFilter === 'clientError') return s >= 400 && s < 500
        if (statusFilter === 'serverError') return s >= 500 && s < 600
      }

      return true
    })
  }, [rows, query, protocol, statusFilter])

  // 2. 排序：基于当前排序列与方向
  const sortedRows = useMemo(() => {
    if (!sortField || !sortOrder) return filteredRows

    return [...filteredRows].sort((a, b) => {
      let valA: any = 0
      let valB: any = 0

      switch (sortField) {
        case 'id':
          valA = a.id
          valB = b.id
          break
        case 'protocol':
          valA = a.protocol || ''
          valB = b.protocol || ''
          break
        case 'method':
          valA = a.method || a.direction || ''
          valB = b.method || b.direction || ''
          break
        case 'host':
          valA = a.host || ''
          valB = b.host || ''
          break
        case 'size':
          valA = (a.requestBytes || 0) + (a.responseBytes || 0) + (a.bodyBytes || 0)
          valB = (b.requestBytes || 0) + (b.responseBytes || 0) + (b.bodyBytes || 0)
          break
        case 'duration':
          valA = a.durationMs || 0
          valB = b.durationMs || 0
          break
        default:
          valA = a.id
          valB = b.id
      }

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
      }

      if (valA === valB) return 0
      return sortOrder === 'asc' ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1
    })
  }, [filteredRows, sortField, sortOrder])

  // 切割出视口内显示的最大数量 (限制 1200 条，保持流畅渲染)
  const visibleRows = useMemo(() => sortedRows.slice(-1200), [sortedRows])

  // 视图内总流量
  const bytesInView = useMemo(
    () => rows.reduce((sum, row) => sum + (row.requestBytes || 0) + (row.responseBytes || 0) + (row.bodyBytes || 0), 0),
    [rows]
  )

  const refreshStatus = useCallback(async () => {
    if (!api) return
    const next = normalizeStatus(await api.status())
    setStatus(next)
    if (!controlsHydratedRef.current || next.running) {
      setPort(next.port || 2025)
      setCaptureTcp(next.captureTcp)
      setCaptureUdp(next.captureUdp)
      setDriverMode(normalizeDriverMode(next.driverMode))
      controlsHydratedRef.current = true
    }
  }, [api])

  const pullRows = useCallback(
    async (reset = false) => {
      if (!api || listBusyRef.current) return
      listBusyRef.current = true
      try {
        const since = reset ? 0 : lastIdRef.current
        const result = await api.list({ since, limit: 500, query, protocol })
        lastIdRef.current = Math.max(lastIdRef.current, result.lastId || 0)
        
        setStatus((current) => ({
          ...current,
          running: result.running,
          total: result.total,
          dropped: result.dropped,
          lastId: result.lastId
        }))

        setRows((current) => {
          const merged = reset ? result.items : [...current, ...result.items]
          const unique = new Map<number, SessionRow>()
          for (const item of merged) unique.set(item.id, item)
          return [...unique.values()].slice(-3000)
        })
      } finally {
        listBusyRef.current = false
      }
    },
    [api, protocol, query]
  )

  const loadDetail = useCallback(
    async (id: number) => {
      if (!api) return
      setSelectedId(id)
      const result = await api.detail(id)
      setDetail(result.item)
    },
    [api]
  )

  const start = async () => {
    if (!api) return
    setBusy(true)
    try {
      const selectedDriver = status.capabilities.driverModes.find((item) => item.value === driverMode)
      if (driverMode !== 'off' && selectedDriver && !selectedDriver.supported) {
        setNotice(selectedDriver.reason || '当前平台不支持所选驱动模式')
        return
      }
      const next = normalizeStatus(await api.start({
        port,
        captureTcp,
        captureUdp,
        driverMode,
        captureAllProcesses: driverMode !== 'off',
        stopNetworkOnce: false,
        processNames: [],
        processPids: [],
        installCert: false,
        setSystemProxy: true,
        maxBodyPreviewBytes: 8192
      }))
      setStatus(next)
      const proxyNotice = next.systemProxy ? `代理已启动并设置系统代理：${next.proxyUrl}` : `代理已启动：${next.proxyUrl}`
      const platformNote = next.capabilities.notes?.[0]
      setNotice(platformNote ? `${proxyNotice}；${platformNote}` : proxyNotice)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!api) return
    const next = normalizeStatus(await api.stop())
    setStatus(next)
    setNotice('抓包已停止')
  }

  const clear = async () => {
    if (!api) return
    await api.clear()
    setRows([])
    setDetail(null)
    setSelectedId(null)
    lastIdRef.current = 0
    setNotice('已清空会话')
  }

  const installCert = async () => {
    if (!api) return
    if (!status.capabilities.installCert) {
      setNotice('当前平台不支持自动安装根证书')
      return
    }
    const result = await api.installCert()
    setNotice(result.ok ? '证书安装请求已完成' : result.message || '证书安装可能需要管理员权限')
  }

  const toggleSystemProxy = async () => {
    if (!api) return
    if (!status.capabilities.systemProxy) {
      setNotice('当前平台不支持自动设置系统代理')
      return
    }
    const result = await api.setSystemProxy(!status.systemProxy)
    setStatus((current) => ({ ...current, systemProxy: result.enabled }))
    setNotice(result.enabled ? '系统代理已设置' : '系统代理已取消')
  }

  const copyProxy = async () => {
    await navigator.clipboard.writeText(status.proxyUrl || `http://127.0.0.1:${port}`)
    setNotice('已复制代理地址')
  }

  // 导出全部会话为 JSON 文件
  const exportSessions = useCallback(() => {
    try {
      const dataStr = JSON.stringify(rows, null, 2)
      const blob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `net-capture-export-${Date.now()}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      setNotice('会话数据已成功导出为 JSON')
    } catch (err) {
      setNotice(`导出失败: ${errorMessage(err)}`)
    }
  }, [rows])

  useEffect(() => {
    void refreshStatus()
    void pullRows(true)
  }, [refreshStatus, pullRows])

  // 自动订阅 + 定时器轮询
  useEffect(() => {
    if (!api) return
    const unsubscribe = api.subscribe(() => {
      void pullRows(false)
    })
    const timer = window.setInterval(() => {
      void refreshStatus()
      void pullRows(false)
    }, 1200)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [api, pullRows, refreshStatus])

  useEffect(() => {
    lastIdRef.current = 0
    setRows([])
    void pullRows(true)
  }, [protocol, query, pullRows])

  // 自动滚动到底部
  useEffect(() => {
    if (!autoScroll || !viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [autoScroll, visibleRows.length])

  return {
    status,
    rows,
    visibleRows,
    bytesInView,
    selectedId,
    detail,
    query,
    setQuery,
    protocol,
    setProtocol,
    statusFilter,
    setStatusFilter,
    sortField,
    sortOrder,
    changeSort,
    
    port,
    setPort,
    captureTcp,
    setCaptureTcp,
    captureUdp,
    setCaptureUdp,
    driverMode,
    setDriverMode,
    
    autoScroll,
    setAutoScroll,
    requestTab,
    setRequestTab,
    responseTab,
    setResponseTab,
    notice,
    setNotice,
    busy,
    theme,
    toggleTheme,
    exportSessions,
    
    loadDetail,
    viewportRef,
    start,
    stop,
    clear,
    installCert,
    toggleSystemProxy,
    copyProxy,
    refreshStatus
  }
}
