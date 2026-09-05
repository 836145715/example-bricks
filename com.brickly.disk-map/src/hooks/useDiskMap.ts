/**
 * useDiskMap：开窗编排。
 * start() 钉住 owned Go 进程 → volume → peek（装载缓存）→ scan(call)。
 * node 事件进 NodeStore（rAF 合并）；下钻一律 peek；删除必须走 trash 命令。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { BricklyStartedHandle } from '@syllm/brickly-ui'

import {
  hasBrickly,
  peekNode,
  pickRootDirectory,
  queryExtStats,
  queryVolume,
  revealInFinder as revealPath,
  scanTree,
  startRuntime,
  trashPaths
} from '../brickly'
import { formatBytes } from '../format'
import { NodeStore } from '../store'
import type {
  ChartView,
  ExtStat,
  ScanEvent,
  TreeNode,
  VolumeInfo
} from '../types'

export type ScanStatus = 'booting' | 'idle' | 'scanning' | 'done' | 'cancelled' | 'error'

export interface TrayItem {
  path: string
  name: string
  allocatedBytes: number
  kind: string
}

function formatGB(bytes: number): string {
  return formatBytes(bytes)
}

function normalizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return String(error)
}

export function useDiskMap() {
  const storeRef = useRef<NodeStore>(new NodeStore())
  const store = storeRef.current
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)

  const handleRef = useRef<BricklyStartedHandle | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const rootRef = useRef<string>('')
  const scanRootRef = useRef<string | null>(null)

  const [bootError, setBootError] = useState<string | null>(null)
  const [volume, setVolume] = useState<VolumeInfo | null>(null)
  const [root, setRoot] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [scanStatus, setScanStatus] = useState<ScanStatus>('booting')
  const [scanMessage, setScanMessage] = useState('正在启动 runtime…')
  const [scanned, setScanned] = useState({ files: 0, bytes: 0 })
  const [tray, setTray] = useState<TrayItem[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [trashing, setTrashing] = useState(false)
  const [trashFailures, setTrashFailures] = useState<string[]>([])
  const [view, setView] = useState<ChartView>('pie')
  const [extStats, setExtStats] = useState<ExtStat[]>([])

  const currentNode: TreeNode | undefined = useMemo(
    () => (currentPath ? store.get(currentPath) : undefined),
    [currentPath, store, version]
  )

  const refreshExtStats = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return
    try {
      setExtStats(await queryExtStats(handle))
    } catch {
      /* 旧 runtime 或扫描前无统计时忽略 */
    }
  }, [])

  const peek = useCallback(async (path?: string) => {
    const handle = handleRef.current
    if (!handle) return null
    try {
      const result = await peekNode(handle, path)
      store.applyPeek(result.node)
      rootRef.current = result.root
      setRoot(result.root)
      if (!path) setCurrentPath(result.node.path)
      return result.node
    } catch (error) {
      const message = normalizeError(error)
      if (!/PATH_NOT_IN_TREE|NOT_SCANNED/i.test(message)) {
        setScanMessage(`读取失败：${message}`)
      }
      return null
    }
  }, [store])

  /** 开窗顺序：volume 先跑完（秒级），再 scan。 */
  const startScan = useCallback(async (rootArg?: string) => {
    const handle = handleRef.current
    if (!handle) return
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setScanStatus('scanning')
    setScanMessage('正在扫描…')
    if (rootArg) {
      scanRootRef.current = rootArg
      setCurrentPath(rootArg)
    } else if (scanRootRef.current) {
      setCurrentPath(scanRootRef.current)
    }
    try {
      const result = await scanTree(handle, rootArg, abort.signal, (event: ScanEvent) => {
        if (event.type === 'progress') {
          setScanned({ files: event.progress.scannedFiles, bytes: event.progress.scannedBytes })
          setScanMessage(`正在扫描 ${event.progress.currentPath}`)
        } else if (event.type === 'node') {
          store.applySummary(event.node)
        } else if (event.type === 'done') {
          setScanned({ files: event.done.scannedFiles, bytes: event.done.scannedBytes })
        }
      })
      setScanStatus(result.completed ? 'done' : 'idle')
      setScanMessage(
        `扫描完成 · ${result.scannedFiles.toLocaleString()} 个文件 · 已见 ${formatGB(result.scannedBytes)}`
      )
      // done 后再 peek 一次根，把根层收齐。
      await peek(scanRootRef.current ?? undefined)
      void refreshExtStats()
    } catch (error) {
      const message = normalizeError(error)
      if (/CANCELLED/i.test(message)) {
        setScanStatus('cancelled')
        setScanMessage('扫描已取消')
      } else if (/SCAN_IN_PROGRESS/i.test(message)) {
        setScanStatus('scanning')
      } else {
        setScanStatus('error')
        setScanMessage(`扫描出错：${message}`)
      }
    }
  }, [peek, refreshExtStats, store])

  const stopScan = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const drillDown = useCallback(async (path: string) => {
    setCurrentPath(path)
    setSelectedPath(null)
    // peek 失败（扫描还没到）也照常切过去，node 事件到达后自动出图。
    await peek(path)
  }, [peek])

  const drillUp = useCallback(async () => {
    const rootPath = rootRef.current
    if (!currentPath || currentPath === rootPath) return
    const parent = currentPath.replace(/\/[^/]+$/, '') || '/'
    if (!parent || parent === currentPath) return
    if (rootPath && parent.length < rootPath.length) {
      await drillDown(rootPath)
      return
    }
    await drillDown(parent)
  }, [currentPath, drillDown])

  const gotoRoot = useCallback(async () => {
    if (rootRef.current) await drillDown(rootRef.current)
  }, [drillDown])

  const chooseRoot = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return
    const dir = await pickRootDirectory(rootRef.current || scanRootRef.current || undefined)
    if (!dir) return
    abortRef.current?.abort()
    store.reset()
    setSelectedPath(null)
    setTrashFailures([])
    setExtStats([])
    scanRootRef.current = dir
    setCurrentPath(dir)
    try {
      setVolume(await queryVolume(handle, dir))
    } catch {
      /* 卷信息失败不阻塞扫描 */
    }
    void startScan(dir)
  }, [startScan, store])

  const addToTray = useCallback((node: {
    path: string
    name: string
    allocatedBytes: number
    flags: { kind: string }
  }) => {
    if (node.flags.kind === 'other') return
    setTray((items) => {
      if (items.some((item) => item.path === node.path)) return items
      return [...items, {
        path: node.path,
        name: node.name,
        allocatedBytes: node.allocatedBytes,
        kind: node.flags.kind
      }]
    })
  }, [])

  const removeFromTray = useCallback((path: string) => {
    setTray((items) => items.filter((item) => item.path !== path))
  }, [])

  const clearTray = useCallback(() => {
    setTray([])
    setTrashFailures([])
  }, [])

  const confirmTrash = useCallback(async () => {
    const handle = handleRef.current
    if (!handle || tray.length === 0) return
    setTrashing(true)
    setTrashFailures([])
    try {
      const result = await trashPaths(handle, tray.map((item) => item.path))
      const failures = result.results
        .filter((item) => !item.ok)
        .map((item) => `${item.path}：${item.error ?? '失败'}`)
      setTrashFailures(failures)
      const freedPaths = result.results.filter((item) => item.ok).map((item) => item.path)
      for (const path of freedPaths) {
        store.remove(path)
        removeFromTray(path)
      }
      if (freedPaths.length > 0) {
        await peek(currentPath || undefined)
      }
      if (failures.length === 0) {
        setConfirmOpen(false)
      }
    } catch (error) {
      setTrashFailures([normalizeError(error)])
    } finally {
      setTrashing(false)
    }
  }, [currentPath, peek, removeFromTray, store, tray])

  const reveal = useCallback((path: string) => {
    revealPath(path)
  }, [])

  // 单次初始化：owned 进程生命周期绑定窗口。不做持久缓存，开窗直接流式扫描。
  useEffect(() => {
    let cancelled = false
    let handle: BricklyStartedHandle | null = null

    void (async () => {
      if (!hasBrickly()) {
        setBootError('底座 API 未注入，请在 AI-Bricks 宿主中运行本应用。')
        setScanStatus('error')
        return
      }
      try {
        handle = await startRuntime()
        if (cancelled) {
          await handle.dispose()
          return
        }
        handleRef.current = handle

        // 1) volume 先跑完（秒级）。
        const volumeInfo = await queryVolume(handle)
        if (cancelled) return
        setVolume(volumeInfo)

        // 2) 直接扫描，UI 边扫边画。
        setScanStatus('idle')
        setScanMessage('正在准备扫描…')
        void refreshExtStats()
        void startScan()
      } catch (error) {
        if (!cancelled) {
          setBootError(`Runtime 启动失败：${normalizeError(error)}`)
          setScanStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      abortRef.current?.abort()
      handleRef.current = null
      if (handle) void handle.dispose()
    }
    // 必须为空依赖，避免重复 start 超出进程上限。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    store,
    version,
    bootError,
    volume,
    root,
    currentPath,
    currentNode,
    selectedPath,
    setSelectedPath,
    scanStatus,
    scanMessage,
    scanned,
    tray,
    confirmOpen,
    setConfirmOpen,
    trashing,
    trashFailures,
    inaccessibleCount: store.inaccessibleCount(),
    view,
    setView,
    extStats,
    canGoUp: Boolean(root && currentPath && currentPath !== root),
    startScan,
    stopScan,
    chooseRoot,
    drillDown,
    drillUp,
    gotoRoot,
    addToTray,
    removeFromTray,
    clearTray,
    confirmTrash,
    reveal
  }
}
