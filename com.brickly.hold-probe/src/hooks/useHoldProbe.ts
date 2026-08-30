import { useMemo, useRef, useState } from 'react'
import {
  fetchProcessInfo,
  getPathForFile,
  pickDirectory,
  pickFile,
  probePath,
  stopProcess
} from '../brickly'
import type { ConfirmTarget, Holder, ProbeResult, ProcessDetails, SortField, SortOrder } from '../types'

function errorMessage(error: unknown): string {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown }
    const msg = e.message != null ? String(e.message) : String(error)
    const code = e.code != null ? String(e.code) : ''
    if (code && !msg.includes(code)) return `[${code}] ${msg}`
    return msg
  }
  return String(error)
}

export function useHoldProbe() {
  const [path, setPath] = useState('')
  const [deep, setDeep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [filterText, setFilterText] = useState('')

  // 排序控制
  const [sortField, setSortField] = useState<SortField>('pid')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // 详情抽屉控制
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [inspectHolder, setInspectHolder] = useState<Holder | null>(null)
  const [processDetails, setProcessDetails] = useState<ProcessDetails | null>(null)
  const [detailsLoadingPid, setDetailsLoadingPid] = useState<number | null>(null)
  const [detailsError, setDetailsError] = useState('')

  // 复制 PID 提示状态
  const [copiedPid, setCopiedPid] = useState<number | null>(null)

  // 弹窗确认控制
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [force, setForce] = useState(false)
  const [killingPid, setKillingPid] = useState<number | null>(null)
  const [modalError, setModalError] = useState('')

  const requestRef = useRef(0)

  // 切换排序规则
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // 开始执行探测
  async function runProbe(targetPath = path) {
    const clean = targetPath.trim()
    if (!clean) {
      setError('请先输入或选择目标文件 / 文件夹路径。')
      return
    }

    const id = ++requestRef.current
    setPath(clean)
    setBusy(true)
    setError('')
    setResult(null)
    const started = performance.now()

    try {
      console.info('[hold-probe] probe start', { path: clean, deep })
      const data = await probePath(clean, deep)
      if (id !== requestRef.current) return
      console.info('[hold-probe] probe done', {
        ms: Math.round(performance.now() - started),
        count: data.count
      })
      setResult(data)
      setPath(data.path || clean)
    } catch (caught) {
      if (id !== requestRef.current) return
      console.error('[hold-probe] probe error', caught)
      setError(errorMessage(caught))
    } finally {
      if (id === requestRef.current) setBusy(false)
    }
  }

  // 选择文件 / 目录
  async function handlePickFile() {
    try {
      const selected = await pickFile()
      if (selected) {
        setPath(selected)
        setResult(null)
        setError('')
        void runProbe(selected)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function handlePickDirectory() {
    try {
      const selected = await pickDirectory()
      if (selected) {
        setPath(selected)
        setResult(null)
        setError('')
        void runProbe(selected)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  // 拖放解析
  function handleDropFile(file: File) {
    try {
      const dropped = getPathForFile(file)
      if (!dropped) {
        setError('无法解析拖放路径（宿主可能不支持文件夹拖放）。')
        return
      }
      setPath(dropped)
      setError('')
      void runProbe(dropped)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  // 打开进程详情
  async function openInspect(holder: Holder, key: string) {
    setSelectedKey(key)
    setInspectHolder(holder)
    setProcessDetails(null)
    setDetailsError('')
    setDetailsLoadingPid(holder.pid)

    try {
      const info = await fetchProcessInfo(holder.pid, holder.startKey)
      setProcessDetails(info)
    } catch (caught) {
      setDetailsError(errorMessage(caught))
    } finally {
      setDetailsLoadingPid(null)
    }
  }

  function closeInspect() {
    setInspectHolder(null)
    setProcessDetails(null)
    setSelectedKey(null)
    setDetailsError('')
  }

  // 复制 PID
  function copyPid(pid: number) {
    void navigator.clipboard.writeText(String(pid))
    setCopiedPid(pid)
    setTimeout(() => setCopiedPid(null), 1500)
  }

  // 打开确认弹窗
  function confirmKill(pid: number, processName: string, startKey: string) {
    setConfirmTarget({ pid, processName, startKey })
    setForce(false)
    setModalError('')
  }

  function cancelKill() {
    setConfirmTarget(null)
    setForce(false)
    setModalError('')
  }

  // 执行终结进程
  async function executeKill() {
    if (!confirmTarget) return
    const { pid, startKey, processName } = confirmTarget

    setKillingPid(pid)
    setModalError('')

    try {
      const res = await stopProcess(pid, startKey, force)
      setConfirmTarget(null)
      setForce(false)

      if (inspectHolder?.pid === pid) {
        closeInspect()
      }

      setError('')
      // 触发重新探针刷新
      await runProbe(path)
    } catch (caught) {
      const msg = errorMessage(caught)
      if (msg.includes('PROCESS_NOT_FOUND') || msg.toLowerCase().includes('not found')) {
        setConfirmTarget(null)
        if (inspectHolder?.pid === pid) closeInspect()
        await runProbe(path)
      } else {
        setModalError(msg)
      }
    } finally {
      setKillingPid(null)
    }
  }

  // 客户端实时模糊过滤 + 动态列排序
  const filteredHolders = useMemo(() => {
    if (!result?.holders) return []
    const q = filterText.trim().toLowerCase()

    let list = result.holders.filter((h) => {
      if (!q) return true
      const pidStr = String(h.pid)
      const name = (h.processName || '').toLowerCase()
      const appType = (h.applicationType || '').toLowerCase()
      const sources = (h.sources || []).join(' ').toLowerCase()
      return pidStr.includes(q) || name.includes(q) || appType.includes(q) || sources.includes(q)
    })

    list = [...list].sort((a, b) => {
      let va: string | number = ''
      let vb: string | number = ''

      if (sortField === 'pid') {
        va = a.pid
        vb = b.pid
      } else if (sortField === 'processName') {
        va = (a.processName || '').toLowerCase()
        vb = (b.processName || '').toLowerCase()
      } else if (sortField === 'applicationType') {
        va = (a.applicationType || '').toLowerCase()
        vb = (b.applicationType || '').toLowerCase()
      } else if (sortField === 'startedAt') {
        va = a.startedAt || ''
        vb = b.startedAt || ''
      } else if (sortField === 'sources') {
        va = (a.sources || []).join(',')
        vb = (b.sources || []).join(',')
      }

      if (va < vb) return sortOrder === 'asc' ? -1 : 1
      if (va > vb) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [result, filterText, sortField, sortOrder])

  return {
    path,
    deep,
    busy,
    error,
    result,
    filterText,
    sortField,
    sortOrder,
    selectedKey,
    inspectHolder,
    processDetails,
    detailsLoadingPid,
    detailsError,
    copiedPid,
    confirmTarget,
    force,
    killingPid,
    modalError,
    filteredHolders,
    setPath,
    setDeep,
    setFilterText,
    toggleSort,
    runProbe,
    handlePickFile,
    handlePickDirectory,
    handleDropFile,
    openInspect,
    closeInspect,
    copyPid,
    confirmKill,
    cancelKill,
    setForce,
    executeKill
  }
}
