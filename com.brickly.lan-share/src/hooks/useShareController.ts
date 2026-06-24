import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearLog as clearLogApi,
  fetchStatus,
  startShare,
  stopShare,
  updateConfig
} from '../brickly'
import type { ShareConfigInput, ShareStatus } from '../types'

const POLL_INTERVAL_MS = 1500

interface ControllerState {
  status: ShareStatus | null
  loading: boolean
  busy: boolean
  error: string
}

/**
 * 共享服务控制器。
 *
 * 负责加载初始状态、在服务运行期间轮询刷新状态（传输日志、连接），
 * 并向 UI 暴露启动 / 停止 / 更新配置 / 清空日志等动作。
 */
export function useShareController() {
  const [state, setState] = useState<ControllerState>({
    status: null,
    loading: true,
    busy: false,
    error: ''
  })
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const applyStatus = useCallback((status: ShareStatus) => {
    setState((prev) => ({ ...prev, status, error: '' }))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const status = await fetchStatus()
      applyStatus(status)
    } catch (error) {
      setState((prev) => ({ ...prev, error: messageOf(error) }))
    }
  }, [applyStatus])

  // 初次加载状态。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await fetchStatus()
        if (!cancelled) setState({ status, loading: false, busy: false, error: '' })
      } catch (error) {
        if (!cancelled) setState({ status: null, loading: false, busy: false, error: messageOf(error) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 运行期间轮询刷新。
  useEffect(() => {
    const running = state.status?.running ?? false
    if (running && !pollTimer.current) {
      pollTimer.current = setInterval(refresh, POLL_INTERVAL_MS)
    } else if (!running && pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current)
        pollTimer.current = null
      }
    }
  }, [state.status?.running, refresh])

  const runAction = useCallback(async (action: () => Promise<ShareStatus | void>) => {
    setState((prev) => ({ ...prev, busy: true, error: '' }))
    try {
      const result = await action()
      if (result) {
        setState((prev) => ({ ...prev, status: result, busy: false }))
      } else {
        await refresh()
        setState((prev) => ({ ...prev, busy: false }))
      }
    } catch (error) {
      setState((prev) => ({ ...prev, busy: false, error: messageOf(error) }))
    }
  }, [refresh])

  const start = useCallback(
    (config: ShareConfigInput) => runAction(() => startShare(config)),
    [runAction]
  )
  const stop = useCallback(() => runAction(() => stopShare()), [runAction])
  const saveConfig = useCallback(
    (config: ShareConfigInput) => runAction(async () => {
      await updateConfig(config)
      return fetchStatus()
    }),
    [runAction]
  )
  const clearLog = useCallback(
    () => runAction(async () => {
      await clearLogApi()
      return fetchStatus()
    }),
    [runAction]
  )

  return {
    status: state.status,
    loading: state.loading,
    busy: state.busy,
    error: state.error,
    refresh,
    start,
    stop,
    saveConfig,
    clearLog
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
