import { AlertCircle, Check, Clipboard, Copy, Info, Loader2, Square, X } from 'lucide-react'
import React, { useState } from 'react'
import type { Holder, ProcessDetails } from '../types'

interface ProcessInspectDrawerProps {
  holder: Holder
  details: ProcessDetails | null
  loading: boolean
  error: string
  targetPath: string
  onClose: () => void
  onConfirmKill: (pid: number, processName: string, startKey: string) => void
}

function formatTime(value: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 进程详情抽屉组件
 * Layout: Flex 顶头固定 + 中间全量单一滚动（子项 flex-shrink:0 绝不压扁）+ 吸底固定的终止进程按钮
 */
export const ProcessInspectDrawer: React.FC<ProcessInspectDrawerProps> = ({
  holder,
  details,
  loading,
  error,
  targetPath,
  onClose,
  onConfirmKill
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  function copyText(text: string, field: string) {
    if (!text || text === '不可读') return
    void navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 1500)
  }

  return (
    <aside className="inspect" aria-label="进程详情面板">
      {/* 1. 固定顶部 Title Header */}
      <div className="inspect-head">
        <div className="inspect-head-title">
          <Info size={14} className="cyan" />
          <h3>进程详细档案</h3>
          <span className="inspect-head-sub">{holder.processName}</span>
        </div>
        <button type="button" className="icon-btn" title="关闭详情" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      {/* 2. 中间单一滚动区域：子项 flex-shrink: 0 保证小窗时不被压扁 */}
      <div className="inspect-body">
        {/* Title Group */}
        <div className="inspect-title">
          <strong>{holder.processName}</strong>
          <span>PID: {holder.pid} · Session: {holder.sessionId} · 类型: {holder.applicationType || 'Standard'}</span>
        </div>

        {/* Key-Value Metrics */}
        <div className="kv">
          <div className="kv-item">
            <span className="k">PID</span>
            <span className="v mono">{holder.pid}</span>
          </div>
          <div className="kv-item">
            <span className="k">父进程 PPID</span>
            <span className="v mono">{details?.parentPid ?? '—'}</span>
          </div>
          <div className="kv-item">
            <span className="k">系统用户</span>
            <span className="v">{details?.user || '—'}</span>
          </div>
          <div className="kv-item">
            <span className="k">可自动重启</span>
            <span className="v">{holder.restartable ? '是 (Restartable)' : '否'}</span>
          </div>
          <div className="kv-item full">
            <span className="k">占用目标路径</span>
            <span className="v mono">{targetPath || '—'}</span>
          </div>
          <div className="kv-item full">
            <span className="k">进程启动时间</span>
            <span className="v">{formatTime(details?.startedAt || holder.startedAt)}</span>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading ? (
          <div className="inspect-loading">
            <div className="skeleton" aria-label="读取进程详情">
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="modal-warning-text">
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>读取扩展进程属性受限: {error}</span>
          </div>
        ) : null}

        {/* 详细块 1: 可执行程序路径 */}
        <div className="block">
          <div className="block-head">
            <span>可执行程序路径 (Executable Path)</span>
            {details?.executablePath ? (
              <button
                type="button"
                className="icon-btn"
                title="复制路径"
                onClick={() => copyText(details.executablePath, 'exe')}
              >
                {copiedField === 'exe' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            ) : null}
          </div>
          <pre>{details?.executablePath || '系统保护进程或缺少读取权限'}</pre>
        </div>

        {/* 详细块 2: 完整启动命令行 */}
        <div className="block">
          <div className="block-head">
            <span>完整启动命令行 (Command Line)</span>
            {details?.commandLine ? (
              <button
                type="button"
                className="icon-btn"
                title="复制命令行"
                onClick={() => copyText(details.commandLine, 'cmd')}
              >
                {copiedField === 'cmd' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            ) : null}
          </div>
          <pre>{details?.commandLine || '无命令行参数或系统权限受限'}</pre>
        </div>

        {/* 详细块 3: 占用来源与安全提示 */}
        <div className="block">
          <div className="block-head">
            <span>文件使用来源</span>
          </div>
          <pre>
            {(holder.sources || []).join(', ') || '系统探测'} · Key: {holder.startKey}
          </pre>
        </div>
      </div>

      {/* 3. 吸底固定的强杀操作栏 */}
      <div className="inspect-foot">
        <div className="inspect-actions">
          <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={() => onConfirmKill(holder.pid, holder.processName, holder.startKey)}
          >
            <Square size={13} />
            终止此进程 (PID {holder.pid})
          </button>
        </div>
        <p className="inspect-tip">
          终止进程可能释放其持有的文件或目录资源。如果包含未保存修改，请先保存数据。
        </p>
      </div>
    </aside>
  )
}
