import clsx from 'clsx'
import { AlertTriangle, Check, Clipboard, Info, Loader2, Square, X } from 'lucide-react'
import React, { useState } from 'react'
import type { ProcessDetails } from '../types'

interface ProcessInspectDrawerProps {
  open: boolean
  details: ProcessDetails | null
  loadingPid: number | null
  error: string | null
  killingPid: number | null
  onClose: () => void
  onCopyText: (value: string | null, label: string) => void
  onConfirmKill: (pid: number, processName?: string | null) => void
}

function platformLabel(platform?: string) {
  if (!platform || platform === 'waiting') return '未扫描'
  if (platform === 'windows') return 'Windows'
  if (platform === 'macos') return 'macOS'
  return platform
}

export const ProcessInspectDrawer: React.FC<ProcessInspectDrawerProps> = ({
  open,
  details,
  loadingPid,
  error,
  killingPid,
  onClose,
  onCopyText,
  onConfirmKill
}) => {
  if (!open) return null

  return (
    <aside className="inspect" aria-label="进程检视面板">
      {/* 顶部固定标题栏 */}
      <div className="inspect-head">
        <div className="inspect-head-title">
          <h3>进程详情</h3>
          {details && !loadingPid && !error && (
            <span className="inspect-head-sub">
              {details.processName || `PID ${details.pid}`} · PID {details.pid}
            </span>
          )}
        </div>
        <button
          type="button"
          className="icon-btn close-btn"
          title="关闭检视"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {/* 中间：唯一滚动区，详情再长也可向下拖看全 */}
      <div className="inspect-body">
        {loadingPid ? (
          <div className="inspect-empty">
            <Loader2 className="spin" size={24} />
            <strong>正在获取进程属性…</strong>
            <span>PID {loadingPid}</span>
          </div>
        ) : error ? (
          <div className="inspect-empty">
            <AlertTriangle size={24} className="err-icon" />
            <strong>读取失败</strong>
            <span>{error}</span>
          </div>
        ) : details ? (
          <>
            <div className="inspect-title">
              <strong>{details.processName || `PID ${details.pid}`}</strong>
              <span>
                PID {details.pid} · {platformLabel(details.platform)}
              </span>
            </div>

            <div className="kv">
              <div className="kv-item">
                <span className="k">父进程 PID</span>
                <span className="v mono">{details.parentPid ?? '—'}</span>
              </div>
              <div className="kv-item">
                <span className="k">系统用户</span>
                <span className="v">{details.user || '—'}</span>
              </div>
              <div className="kv-item">
                <span className="k">进程状态</span>
                <span className="v mono">{details.state || '—'}</span>
              </div>
              <div className="kv-item">
                <span className="k">运行时间</span>
                <span className="v mono">{details.elapsed || '—'}</span>
              </div>
              <div className="kv-item full">
                <span className="k">启动时间</span>
                <span className="v">{details.startedAt || '—'}</span>
              </div>
            </div>

            <DetailBlock
              label="可执行程序路径"
              value={details.executablePath}
              onCopy={() => onCopyText(details.executablePath, '可执行路径')}
            />
            <DetailBlock
              label="工作目录 (CWD)"
              value={details.workingDirectory}
              onCopy={() => onCopyText(details.workingDirectory, '工作目录')}
            />
            <DetailBlock
              label="完整启动命令行"
              value={details.commandLine}
              onCopy={() => onCopyText(details.commandLine, '启动命令')}
            />
          </>
        ) : (
          <div className="inspect-empty">
            <Info size={24} />
            <strong>暂无检视对象</strong>
            <span>请在表格中选中任一行查看进程属性</span>
          </div>
        )}
      </div>

      {/* 底部：结束按钮固定，不随详情内容滚动 */}
      {details && !loadingPid && !error ? (
        <div className="inspect-foot">
          <button
            type="button"
            className="btn btn-danger btn-block"
            disabled={killingPid === details.pid}
            onClick={() => onConfirmKill(details.pid, details.processName)}
          >
            {killingPid === details.pid ? <Loader2 className="spin" size={14} /> : <Square size={13} />}
            结束此进程
          </button>
          <p className="inspect-tip">PID {details.pid} · 确认时再选择是否强制（Windows 始终强制）</p>
        </div>
      ) : null}
    </aside>
  )
}

function DetailBlock({ label, value, onCopy }: { label: string; value: string | null; onCopy(): void }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="block">
      <div className="block-head">
        <span>{label}</span>
        <button
          type="button"
          className={clsx('icon-btn', copied && 'ok')}
          title={`复制${label}`}
          disabled={!value}
          onClick={() => {
            onCopy()
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
        </button>
      </div>
      <pre>{value || '无权限或不可读'}</pre>
    </section>
  )
}
