import clsx from 'clsx'
import { Activity, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import React from 'react'
import type { KillProcessResult } from '../types'
import type { Notice } from '../hooks/usePortInspector'

interface MetricsBarProps {
  summary: {
    records: number
    processes: number
    tcp: number
    udp: number
  }
  notice: Notice
  lastKill: KillProcessResult | null
}

/**
 * 仪表指示与通知栏组件
 */
export const MetricsBar: React.FC<MetricsBarProps> = ({ summary, notice, lastKill }) => {
  return (
    <div className="meter" aria-label="扫描概览指标">
      <div className="meter-item" title="当前显示的套接字连接条目总数">
        <span className="k">连接数</span>
        <span className="v">{summary.records}</span>
      </div>
      <div className="meter-item" title="涉及的不重复 PID 进程总数">
        <span className="k">进程数</span>
        <span className="v">{summary.processes}</span>
      </div>
      <div className="meter-item" title="TCP 协议连接数">
        <span className="k">TCP</span>
        <span className="v">{summary.tcp}</span>
      </div>
      <div className="meter-item" title="UDP 协议套接字数">
        <span className="k">UDP</span>
        <span className="v sky">{summary.udp}</span>
      </div>

      {lastKill && (
        <div className="meter-item" title={`上次结束进程的时间: ${lastKill.killedAt}`}>
          <span className="k">上次结束</span>
          <span className="v soft">PID {lastKill.pid} ({lastKill.processName || '已终止'})</span>
        </div>
      )}

      {/* 实时状态/提示 */}
      <div className="meter-item grow">
        <div
          className={clsx(
            'meter-notice',
            notice.kind === 'ok' && 'ok',
            notice.kind === 'error' && 'err'
          )}
          title={notice.text}
        >
          <span className="notice-icon">
            {notice.kind === 'ok' ? (
              <CheckCircle2 size={12} />
            ) : notice.kind === 'error' ? (
              <AlertCircle size={12} />
            ) : (
              <Info size={12} />
            )}
          </span>
          <span className="notice-text">{notice.text}</span>
        </div>
      </div>
    </div>
  )
}
