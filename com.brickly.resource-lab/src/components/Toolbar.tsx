import { Download, FlaskConical, Play, Square, Trash2 } from 'lucide-react'

interface ToolbarProps {
  busy: boolean
  hasRun: boolean
  hasFocus: boolean
  serviceReady: boolean
  onRunFocused(): void
  onRunDefault(): void
  onRunStress(): void
  onStop(): void
  onClear(): void
  onExport(): void
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">R/L</span>
        <div>
          <h1>资源验收测试台</h1>
          <p>逐场景说明 · 单独运行 · 失败可见</p>
        </div>
      </div>
      <div className="toolbar-actions">
        <button
          type="button"
          className="primary"
          onClick={props.onRunFocused}
          disabled={props.busy || !props.hasFocus || !props.serviceReady}
          title="只运行当前选中的场景"
        >
          <Play /> 运行当前场景
        </button>
        <button
          type="button"
          onClick={props.onRunDefault}
          disabled={props.busy || !props.serviceReady}
          title="运行全部默认场景"
        >
          默认全测
        </button>
        <button
          type="button"
          className="stress"
          onClick={props.onRunStress}
          disabled={props.busy || !props.serviceReady}
          title="运行压力套件（大文件）"
        >
          <FlaskConical /> 压力
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="icon danger"
          onClick={props.onStop}
          disabled={!props.busy}
          title="停止"
        >
          <Square />
        </button>
        <button
          type="button"
          className="icon"
          onClick={props.onExport}
          disabled={!props.hasRun}
          title="导出 JSON 报告"
        >
          <Download />
        </button>
        <button
          type="button"
          className="icon"
          onClick={props.onClear}
          disabled={!props.hasRun && !props.busy}
          title="清空本窗口结果"
        >
          <Trash2 />
        </button>
      </div>
    </header>
  )
}
