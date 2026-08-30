import { ImageSquare, Minus, Square, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

interface TitleBarProps {
  fileCount: number
}

/**
 * 自绘标题栏：拖动区 + 窗口控制按钮（最小化/最大化/关闭）
 * 依赖平台 titleBar=custom 时注入的 window.brickly.window
 */
export function TitleBar({ fileCount }: TitleBarProps) {
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
        <div className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-[var(--ac-soft)] text-[var(--ac)]">
          <ImageSquare size={13} weight="duotone" />
        </div>
        <span className="titlebar-title">万能图片工具箱</span>
        <span className="titlebar-id">{window.brickly?.brickId ?? 'com.brickly.image-toolkit-sharp'}</span>
        <span className="titlebar-badge">
          {fileCount === 0 ? '未选择文件' : `${fileCount} 个文件`}
        </span>
      </div>

      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          title="最小化"
          disabled={!api}
          onClick={() => void api?.minimize()}
        >
          <Minus size={13} />
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
            <Square size={11} />
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
          <X size={14} />
        </button>
      </div>
    </header>
  )
}
