import clsx from 'clsx'
import { Minus, Search, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * 自绘标题栏：拖动区 + 索引状态 + 最小化 / 最大化 / 关闭。
 * 需要 manifest ui.titleBar = "custom"，平台注入 window.brickly.window。
 */
export function TitleBar({
  indexReady,
  statusText
}: {
  indexReady: boolean
  statusText: string
}) {
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
  const brickId = window.brickly?.ref?.brickId ?? 'com.brickly.local-search'

  return (
    <header className="titlebar" aria-label="窗口标题栏">
      <div
        className="titlebar-drag"
        onDoubleClick={() => {
          if (api) void api.toggleMaximize()
        }}
      >
        <span className="titlebar-mark" aria-hidden>
          <Search size={12} strokeWidth={2.2} />
        </span>
        <span className="titlebar-title">本地搜索</span>
        <span className="titlebar-id">{brickId}</span>
      </div>

      <div className="titlebar-meta" title={statusText}>
        <span className={clsx('titlebar-status-dot', indexReady ? 'is-ok' : 'is-warn')} />
        <span className="titlebar-status">{indexReady ? '索引可用' : '索引未就绪'}</span>
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
          disabled={!api && !window.brickly?.closeWindow}
          onClick={() => {
            if (api) void api.close()
            else window.brickly?.closeWindow()
          }}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  )
}
