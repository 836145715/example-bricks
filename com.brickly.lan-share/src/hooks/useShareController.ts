import { useCallback, useEffect, useRef, useState } from 'react'
import type { BricklyStartedHandle } from '@syllm/brickly-ui'
import {
  bindRuntime,
  clearLog as clearLogApi,
  fetchStatus,
  startShare,
  stopShare
} from '../brickly'
import {
  LifecycleRequestGate,
  loadShareSnapshot,
  ShareLifecycleStateError,
  startShareLifecycle,
  stopShareLifecycle,
  type ShareLifecycleApi,
  type ShareSnapshot
} from '../share-lifecycle'
import {
  createStoppedStatus,
  loadShareSettings,
  saveShareSettings,
  type ShareSettings
} from '../share-settings'
import type { ShareConfigInput } from '../types'

const POLL_INTERVAL_MS = 1500

type ControllerOperation = 'starting' | 'stopping' | 'working' | null

interface ControllerState {
  snapshot: ShareSnapshot | null
  loading: boolean
  operation: ControllerOperation
  error: string
}

const lifecycleApi: ShareLifecycleApi = {
  fetchStatus,
  startShare,
  stopShare
}

/** 绑定体验窗占用的 owned runtime，只通过 HTTP 共享命令启停文件服务。 */
export function useShareController() {
  const [state, setState] = useState<ControllerState>({
    snapshot: null,
    loading: true,
    operation: null,
    error: ''
  })
  const mountedRef = useRef(false)
  const snapshotRef = useRef<ShareSnapshot | null>(null)
  const settingsRef = useRef<ShareSettings>(loadShareSettings(window.localStorage))
  const operationRef = useRef<Promise<void> | null>(null)
  const requestGateRef = useRef(new LifecycleRequestGate())
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const applySnapshot = useCallback((snapshot: ShareSnapshot, error = '') => {
    snapshotRef.current = snapshot
    settingsRef.current = saveShareSettings(
      window.localStorage,
      snapshot.status,
      snapshot.status.hasAccessCode
    )
    if (!mountedRef.current) return
    setState((previous) => ({
      ...previous,
      snapshot,
      loading: false,
      error
    }))
  }, [])

  const applyError = useCallback(
    (error: unknown) => {
      if (error instanceof ShareLifecycleStateError) {
        const previous = snapshotRef.current
        const snapshot =
          !error.runtimeStatusKnown && previous
            ? { status: previous.status }
            : error.snapshot
        applySnapshot(snapshot, error.message)
        return
      }
      if (mountedRef.current) {
        setState((previous) => ({ ...previous, loading: false, error: messageOf(error) }))
      }
    },
    [applySnapshot]
  )

  const refresh = useCallback(async () => {
    const epoch = requestGateRef.current.capture()
    try {
      const snapshot = await loadShareSnapshot(lifecycleApi, settingsRef.current)
      if (!requestGateRef.current.isCurrent(epoch) || operationRef.current) return
      applySnapshot(snapshot)
    } catch (error) {
      if (!requestGateRef.current.isCurrent(epoch) || operationRef.current) return
      applyError(error)
    }
  }, [applyError, applySnapshot])

  useEffect(() => {
    let cancelled = false
    let started: BricklyStartedHandle | null = null
    mountedRef.current = true

    void (async () => {
      try {
        if (!window.brickly?.start) {
          throw new Error('window.brickly.start 不可用，请在 Brickly Webview 中打开本工具。')
        }
        started = await window.brickly.start()
        if (cancelled) {
          await started.dispose()
          return
        }
        bindRuntime(started)
        const snapshot = await loadShareSnapshot(lifecycleApi, settingsRef.current)
        if (!cancelled) applySnapshot(snapshot)
      } catch (error) {
        if (!cancelled) applyError(error)
      }
    })()

    return () => {
      cancelled = true
      mountedRef.current = false
      bindRuntime(null)
      if (started) void started.dispose()
    }
  }, [applyError, applySnapshot])

  const shouldPoll = state.operation === null && Boolean(state.snapshot?.status.running)

  useEffect(() => {
    if (shouldPoll && !pollTimer.current) {
      pollTimer.current = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    } else if (!shouldPoll && pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current)
        pollTimer.current = null
      }
    }
  }, [refresh, shouldPoll])

  const runAction = useCallback(
    (operation: Exclude<ControllerOperation, null>, action: () => Promise<void>) => {
      if (operationRef.current) return operationRef.current
      requestGateRef.current.invalidate()
      if (mountedRef.current) {
        setState((previous) => ({ ...previous, operation, error: '' }))
      }

      const promise = (async () => {
        try {
          await action()
        } catch (error) {
          applyError(error)
        } finally {
          operationRef.current = null
          if (mountedRef.current) {
            setState((previous) => ({ ...previous, operation: null }))
          }
        }
      })()
      operationRef.current = promise
      return promise
    },
    [applyError]
  )

  const start = useCallback(
    (config: ShareConfigInput) => {
      const root = config.root?.trim() ?? ''
      if (!root) {
        setState((previous) => ({ ...previous, error: '请先填写共享目录。' }))
        return
      }
      const port = Number(config.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        setState((previous) => ({ ...previous, error: '端口必须是 1 到 65535 之间的整数。' }))
        return
      }

      void runAction('starting', async () => {
        const current = snapshotRef.current
        const hasAccessCode = current?.status.hasAccessCode ?? settingsRef.current.hasAccessCode
        settingsRef.current = saveShareSettings(
          window.localStorage,
          { ...config, root, port },
          hasAccessCode
        )
        const snapshot = await startShareLifecycle(
          lifecycleApi,
          { ...config, root, port },
          settingsRef.current
        )
        applySnapshot(snapshot)
      })
    },
    [applySnapshot, runAction]
  )

  const stop = useCallback(() => {
    void runAction('stopping', async () => {
      const result = await stopShareLifecycle(lifecycleApi, settingsRef.current)
      applySnapshot(result.snapshot, result.warning)
    })
  }, [applySnapshot, runAction])

  const saveConfig = useCallback(
    (config: ShareConfigInput) => {
      const current = snapshotRef.current
      if (!current || current.status.running) return
      settingsRef.current = saveShareSettings(
        window.localStorage,
        config,
        current.status.hasAccessCode
      )
      applySnapshot({
        status: createStoppedStatus(settingsRef.current)
      })
    },
    [applySnapshot]
  )

  const clearLog = useCallback(() => {
    void runAction('working', async () => {
      await clearLogApi()
      const snapshot = await loadShareSnapshot(lifecycleApi, settingsRef.current)
      applySnapshot(snapshot)
    })
  }, [applySnapshot, runAction])

  return {
    status: state.snapshot?.status ?? null,
    loading: state.loading,
    busy: state.operation !== null,
    operation: state.operation,
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
