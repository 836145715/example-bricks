import { Loader2 } from 'lucide-react'

export function IndexLoading({ checking, starting }: { checking: boolean; starting?: boolean }) {
  const title = checking ? '正在检查索引' : starting ? '正在启动 Everything' : '正在建立索引'
  const description = checking
    ? '检测自带 Everything 是否已就绪'
    : starting
      ? '以后台实例启动捆绑的 Everything，不依赖本机安装'
      : 'Everything 已连接，索引完成后会自动显示结果。'
  return (
    <div className="empty index-loading">
      <Loader2 size={28} className="spin" />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}
