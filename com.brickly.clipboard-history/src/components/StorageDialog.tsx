import clsx from 'clsx'
import { Database, Cpu, X } from 'lucide-react'
import React from 'react'
import type { RuntimeStatus, StorageInfo } from '../types'

export interface StorageDialogData {
  store: StorageInfo | null
  runtime: RuntimeStatus | null
  api: {
    commands: boolean
    events: boolean
  }
}

interface StorageDialogProps {
  data: StorageDialogData
  onClose: () => void
}

/**
 * 存储与运行时状态数据仪表盘弹窗：
 * 展示持久化 SQLite 数据库路径、媒体资源目录、存储限制、Runtime 通信通道指标。
 */
export const StorageDialog: React.FC<StorageDialogProps> = ({ data, onClose }) => {
  const storeData = data.store
  const runtimeData = data.runtime
  const apiStatus = data.api

  return (
    <div className="overlay" onClick={onClose}>
      <article className="dialog" onClick={(event) => event.stopPropagation()}>
        {/* 弹窗 Header */}
        <div className="flex justify-between items-center pb-2 border-b border-white/[0.04]">
          <div className="dialog__title">
            <Database size={15} />
            <span>存储与运行时数据仪表盘</span>
          </div>
          <button type="button" className="sb-btn shrink-0" onClick={onClose} title="关闭">
            <X size={13} />
          </button>
        </div>

        <div className="dialog__sub">
          当前剪贴板归档服务由核心引擎插件{' '}
          <code className="text-[var(--ac)] bg-white/[0.04] px-1.5 py-0.5 rounded font-mono text-[11px]">
            com.brickly.clipboard-history
          </code>{' '}
          常驻托管运行。
        </div>

        {/* 数据网格卡片 */}
        <div className="dialog-grid">
          <div className="dialog-card">
            <div className="dialog-card__label">存储总条数</div>
            <div className="dialog-card__value text-cyan-400 font-semibold">
              {storeData?.count ?? 0} 条
            </div>
          </div>

          <div className="dialog-card">
            <div className="dialog-card__label">存储大小限制</div>
            <div className="dialog-card__value text-slate-300">
              {storeData?.maxItems ?? 500} 条历史记录
            </div>
          </div>

          <div className="dialog-card col-span-2">
            <div className="dialog-card__label">数据库文件路径</div>
            <div
              className="dialog-card__value select-text font-mono text-[11px] text-slate-300 truncate"
              title={storeData?.dbPath}
            >
              {storeData?.dbPath || '未初始化存储'}
            </div>
          </div>

          <div className="dialog-card col-span-2">
            <div className="dialog-card__label">媒体资源库目录</div>
            <div
              className="dialog-card__value select-text font-mono text-[11px] text-slate-300 truncate"
              title={storeData?.mediaDir}
            >
              {storeData?.mediaDir || '无独立媒体存储'}
            </div>
          </div>

          <div className="dialog-card">
            <div className="dialog-card__label">Runtime 监听状态</div>
            <div className="dialog-card__value flex items-center gap-1.5">
              <span
                className={clsx(
                  'w-2 h-2 rounded-full',
                  runtimeData?.state === 'running'
                    ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                    : 'bg-slate-500'
                )}
              />
              <span
                className={
                  runtimeData?.state === 'running'
                    ? 'text-emerald-400 font-medium'
                    : 'text-slate-400'
                }
              >
                {runtimeData?.state === 'running' ? '实时运行中' : '未就绪'}
              </span>
            </div>
          </div>

          <div className="dialog-card">
            <div className="dialog-card__label">Runtime 通信通道</div>
            <div className="dialog-card__value flex items-center gap-1.5 text-slate-300">
              <Cpu size={12} className="text-violet-400" />
              <span>
                {apiStatus.commands && apiStatus.events ? '命令与事件正常' : '事件通知受限'}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 text-right">
          <button
            type="button"
            className="px-5 py-1.5 text-[12px] bg-[var(--ac)] text-slate-950 font-bold rounded-lg hover:bg-cyan-300 transition-colors shadow-lg hover:shadow-cyan-500/20"
            onClick={onClose}
          >
            确 认 并 关 闭
          </button>
        </div>
      </article>
    </div>
  )
}
