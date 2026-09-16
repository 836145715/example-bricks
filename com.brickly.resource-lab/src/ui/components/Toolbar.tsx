import { Play, Square } from 'lucide-react'

interface ToolbarProps {
  busy: boolean
  hasFocus: boolean
  runtimeReady: boolean
  onRunFocused(): void
  onStop(): void
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">R/L</span>
        <div>
          <h1>资源验收测试台</h1>
          <p>点场景 · 看过/不过 · 关窗重置</p>
        </div>
      </div>
      <div className="toolbar-actions">
        <button
          type="button"
          className="primary"
          onClick={props.onRunFocused}
          disabled={props.busy || !props.hasFocus || !props.runtimeReady}
          title="运行当前选中的场景"
        >
          <Play /> 运行
        </button>
        <button
          type="button"
          className="icon danger"
          onClick={props.onStop}
          disabled={!props.busy}
          title="停止"
        >
          <Square />
        </button>
      </div>
    </header>
  )
}
