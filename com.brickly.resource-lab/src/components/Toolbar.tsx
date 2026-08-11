import { Download, FlaskConical, Play, RotateCcw, Square, Trash2 } from 'lucide-react'

interface ToolbarProps {
  busy: boolean
  hasRun: boolean
  selectedCount: number
  onRunDefault(): void
  onRunStress(): void
  onRunSelected(): void
  onStop(): void
  onClear(): void
  onExport(): void
}

export function Toolbar(props: ToolbarProps) {
  return <header className="toolbar">
    <div className="brand">
      <span className="brand-mark">R/L</span>
      <div><h1>资源验收测试台</h1><p>PUBLIC SDK CONFORMANCE</p></div>
    </div>
    <div className="toolbar-actions">
      <button className="primary" onClick={props.onRunDefault} disabled={props.busy} title="运行默认套件"><Play />默认全测</button>
      <button onClick={props.onRunSelected} disabled={props.busy || props.selectedCount === 0} title="运行选中的场景"><RotateCcw />运行选中 <span className="count">{props.selectedCount}</span></button>
      <button className="stress" onClick={props.onRunStress} disabled={props.busy} title="运行压力套件"><FlaskConical />压力测试</button>
      <span className="toolbar-divider" />
      <button className="icon danger" onClick={props.onStop} disabled={!props.busy} title="停止当前批次"><Square /></button>
      <button className="icon" onClick={props.onExport} disabled={!props.hasRun} title="导出脱敏 JSON"><Download /></button>
      <button className="icon" onClick={props.onClear} disabled={!props.hasRun} title="清空本窗口结果"><Trash2 /></button>
    </div>
  </header>
}
