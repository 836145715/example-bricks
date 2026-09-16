import clsx from 'clsx'
import { Sparkles } from 'lucide-react'
import React from 'react'

interface ToastProps {
  message: string
}

/**
 * 浮动操作提示组件：
 * 用于复制成功、同步完成、删除提醒等轻量通知。
 */
export const Toast: React.FC<ToastProps> = ({ message }) => {
  return (
    <div className={clsx('toast', message && 'toast-visible')} role="status" aria-live="polite">
      <Sparkles size={13} className="animate-pulse" />
      <span>{message}</span>
    </div>
  )
}
