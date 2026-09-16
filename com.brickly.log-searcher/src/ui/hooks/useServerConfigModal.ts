import { useState, useCallback, useEffect } from 'react'
import type { ConnectionTestState, LogFileConfig, ServerConfig } from '../types'

interface UseServerConfigModalOptions {
  servers: ServerConfig[]
  onSave: (nextServers: ServerConfig[]) => Promise<void>
  invokeSelf: <TResult = unknown>(cmd: string, input?: Record<string, unknown>) => Promise<TResult>
}

/**
 * 管理服务器配置弹窗状态与表单操作的 Hook
 */
export function useServerConfigModal({
  servers,
  onSave,
  invokeSelf
}: UseServerConfigModalOptions) {
  const [configPanelOpen, setConfigPanelOpen] = useState<boolean>(false)
  const [editingServer, setEditingServer] = useState<ServerConfig | null>(null)
  const [connectionTest, setConnectionTest] = useState<ConnectionTestState>({
    status: 'idle',
    message: ''
  })

  const cloneServerForEditing = (srv: ServerConfig): ServerConfig => ({
    ...srv,
    logs: srv.logs.map(l => ({ ...l }))
  })

  const closeModal = useCallback(() => {
    setConfigPanelOpen(false)
    setEditingServer(null)
    setConnectionTest({ status: 'idle', message: '' })
  }, [])

  const openEditModal = useCallback((srv: ServerConfig) => {
    setEditingServer(cloneServerForEditing(srv))
    setConnectionTest({ status: 'idle', message: '' })
    setConfigPanelOpen(true)
  }, [])

  const openCreateModal = useCallback(() => {
    const newServer: ServerConfig = {
      id: 'srv_' + Date.now(),
      name: '未命名服务器',
      host: '',
      port: 22,
      user: 'root',
      authType: 'password',
      password: '',
      keyPath: '',
      keyText: '',
      logs: [{ path: '', enabled: true }]
    }
    setEditingServer(newServer)
    setConnectionTest({ status: 'idle', message: '' })
    setConfigPanelOpen(true)
  }, [])

  // 监听 Esc 键关闭
  useEffect(() => {
    if (!configPanelOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [configPanelOpen, closeModal])

  const handleAddLogPath = useCallback(() => {
    if (!editingServer) return
    setEditingServer({
      ...editingServer,
      logs: [...editingServer.logs, { path: '', enabled: true }]
    })
  }, [editingServer])

  const handleUpdateLogPath = useCallback((index: number, fields: Partial<LogFileConfig>) => {
    if (!editingServer) return
    const nextLogs = editingServer.logs.map((l, i) => (i === index ? { ...l, ...fields } : l))
    setEditingServer({ ...editingServer, logs: nextLogs })
  }, [editingServer])

  const handleRemoveLogPath = useCallback((index: number) => {
    if (!editingServer) return
    const nextLogs = editingServer.logs.filter((_, i) => i !== index)
    setEditingServer({
      ...editingServer,
      logs: nextLogs.length > 0 ? nextLogs : [{ path: '', enabled: true }]
    })
  }, [editingServer])

  const handleTestConnection = useCallback(async () => {
    if (!editingServer) return
    setConnectionTest({ status: 'testing', message: '正在测试连接...' })
    try {
      const res = await invokeSelf<{ ok: boolean; message: string; filesCount: number }>(
        'test_connection',
        { server: editingServer }
      )
      if (res.ok) {
        setConnectionTest({
          status: 'success',
          message: res.message || `连接成功！找到 ${res.filesCount} 个日志文件`
        })
      } else {
        setConnectionTest({
          status: 'error',
          message: res.message || '连接失败'
        })
      }
    } catch (err: any) {
      setConnectionTest({
        status: 'error',
        message: err.message || '测试连接发生异常'
      })
    }
  }, [editingServer, invokeSelf])

  const handleSaveForm = useCallback(async () => {
    if (!editingServer) return
    const cleanedLogs = editingServer.logs
      .filter(l => l.path.trim() !== '')
      .map(l => ({ ...l, path: l.path.trim() }))
    const serverToSave = { ...editingServer, logs: cleanedLogs }

    let nextServers: ServerConfig[] = []
    const exists = servers.some(s => s.id === serverToSave.id)
    if (exists) {
      nextServers = servers.map(s => (s.id === serverToSave.id ? serverToSave : s))
    } else {
      nextServers = [...servers, serverToSave]
    }

    await onSave(nextServers)
    closeModal()
  }, [closeModal, editingServer, onSave, servers])

  return {
    configPanelOpen,
    editingServer,
    connectionTest,
    setEditingServer,
    openCreateModal,
    openEditModal,
    closeModal,
    handleAddLogPath,
    handleUpdateLogPath,
    handleRemoveLogPath,
    handleTestConnection,
    handleSaveForm
  }
}
