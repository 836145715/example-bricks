import { useEffect, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { BricklyLaunchContext } from '@syllm/brickly-ui'
import type { QueryDraft, ServerConfig } from '../types'
import type { WorkspaceAction } from '../state/workspaceActions'

/** ssh-manager 经 openUi 传入的启动场景。params 是不可信输入，先校验形状再使用。 */
interface SshSessionLaunchParams {
  kind: 'ssh-session'
  ssh: {
    hostId: string
    name: string
    host: string
    port: number
    user: string
    authType: 'password' | 'key'
  }
  pattern?: string
  files?: string[]
}

function readSshSessionParams(params: unknown): SshSessionLaunchParams | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const candidate = params as Partial<SshSessionLaunchParams>
  if (candidate.kind !== 'ssh-session') return null
  const ssh = candidate.ssh
  if (!ssh || typeof ssh !== 'object') return null
  if (typeof ssh.host !== 'string' || !ssh.host.trim()) return null
  if (typeof ssh.user !== 'string' || !ssh.user.trim()) return null
  return {
    kind: 'ssh-session',
    ssh: {
      hostId: typeof ssh.hostId === 'string' ? ssh.hostId : '',
      name: typeof ssh.name === 'string' ? ssh.name : '',
      host: ssh.host.trim(),
      port: typeof ssh.port === 'number' && ssh.port > 0 ? ssh.port : 22,
      user: ssh.user.trim(),
      authType: ssh.authType === 'key' ? 'key' : 'password'
    },
    pattern: typeof candidate.pattern === 'string' && candidate.pattern ? candidate.pattern : undefined,
    files: Array.isArray(candidate.files)
      ? candidate.files.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : undefined
  }
}

/**
 * 启动场景消费：等配置加载完成后把 ssh-session 上下文落到工作区。
 * 已保存的同 host+port+user 服务器直接选中并预填检索草稿；
 * 未保存则打开新建弹窗预填连接信息（凭据不跨砖，由用户补全一次）。
 */
export function useLaunchContext(input: {
  configReady: boolean
  servers: ServerConfig[]
  dispatch: Dispatch<WorkspaceAction>
  openCreateModal: (prefill?: Partial<ServerConfig>) => void
  showToast: (message: string) => void
}): void {
  const { configReady, servers, dispatch, openCreateModal, showToast } = input
  const pendingRef = useRef<BricklyLaunchContext | null>(null)
  const appliedKeyRef = useRef('')
  const [contextTick, setContextTick] = useState(0)

  useEffect(() => {
    if (typeof window.brickly?.onLaunchContext !== 'function') return
    return window.brickly.onLaunchContext((context) => {
      pendingRef.current = context
      setContextTick((tick) => tick + 1)
    })
  }, [])

  useEffect(() => {
    const context = pendingRef.current
    if (!configReady || !context) return
    const contextKey = JSON.stringify([context.entry, context.params, context.from.ref, context.from.via])
    if (appliedKeyRef.current === contextKey) return
    appliedKeyRef.current = contextKey

    const parsed = readSshSessionParams(context.params)
    if (!parsed) return
    // 用户可见文案不直接展示 brickId 反域名，去掉包名前缀留可读短名
    const source = context.from.ref?.brickId?.replace(/^com\.brickly\./, '') ?? context.from.via
    const match = servers.find(
      (server) =>
        server.host === parsed.ssh.host &&
        (server.port || 22) === parsed.ssh.port &&
        server.user === parsed.ssh.user
    )

    if (match) {
      dispatch({ type: 'SELECT_SERVER', serverId: match.id })
      const draft: Partial<QueryDraft> = {}
      if (parsed.pattern) draft.pattern = parsed.pattern
      if (parsed.files?.length) draft.selectedFiles = parsed.files
      if (Object.keys(draft).length > 0) {
        dispatch({ type: 'UPDATE_DRAFT', serverId: match.id, draft })
      }
      showToast(`已带入 ${source} 的服务器「${match.name || match.host}」，输入关键词即可查询`)
      return
    }

    openCreateModal({
      name: parsed.ssh.name || parsed.ssh.host,
      host: parsed.ssh.host,
      port: parsed.ssh.port,
      user: parsed.ssh.user,
      authType: parsed.ssh.authType
    })
    showToast(`${source} 的主机尚未保存，已带入连接信息，补全凭据与日志路径后保存`)
  }, [configReady, servers, contextTick, dispatch, openCreateModal, showToast])
}
