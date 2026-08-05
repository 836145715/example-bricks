import { Minus, Square, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'

/**
 * 自绘标题栏：拖动区 + 最小化 / 最大化 / 关闭。
 * 依赖平台 titleBar=custom 时注入的 window.brickly.window。
 */
export const TitleBar: React.FC = () => {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.brickly?.window
    if (!api) return

    let cancelled = false
    void api.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value)
    })
    const off = api.onMaximizeChange((value) => setMaximized(value))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const api = window.brickly?.window

  return (
    <header className="titlebar" aria-label="窗口标题栏">
      <div className="titlebar-drag">
        <span className="titlebar-mark" aria-hidden />
        <span className="titlebar-title">端口占用查询</span>
        <span className="titlebar-id">{window.brickly?.brickId ?? 'com.brickly.port-inspector'}</span>
      </div>

      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          title="最小化"
          disabled={!api}
          onClick={() => void api?.minimize()}
        >
          <Minus size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          title={maximized ? '还原' : '最大化'}
          disabled={!api}
          onClick={() => void api?.toggleMaximize()}
        >
          {maximized ? (
            <span className="titlebar-restore" aria-hidden>
              <i />
              <i />
            </span>
          ) : (
            <Square size={12} strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          title="关闭"
          disabled={!api}
          onClick={() => {
            if (api) void api.close()
            else window.brickly?.closeWindow?.()
          }}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  )
}
