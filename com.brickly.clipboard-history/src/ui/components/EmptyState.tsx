import { ClipboardList } from 'lucide-react'
import React from 'react'

/**
 * 空状态视图组件：
 * 当剪贴板历史为空或未匹配到筛选结果时展示。
 */
export const EmptyState: React.FC = () => {
  return (
    <div className="empty animate-[fadeIn_0.5s_ease]">
      <div className="empty-icon-glow">
        <ClipboardList size={32} className="animate-pulse" />
      </div>
      <h3 className="empty__hint">暂无归档记录</h3>
      <p className="empty__desc">
        在系统任意位置复制文本、图片或文件，它们将实时同步呈现于此。
      </p>
    </div>
  )
}
