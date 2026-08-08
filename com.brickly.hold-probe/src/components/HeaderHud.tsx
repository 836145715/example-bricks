import { Folder, HardDrive, Play, RefreshCw, Search, X } from 'lucide-react'
import React from 'react'

const isMacOS = navigator.userAgent.includes('Mac')

interface HeaderHudProps {
  path: string
  deep: boolean
  busy: boolean
  onPathChange: (val: string) => void
  onDeepChange: (val: boolean) => void
  onPickFile: () => void
  onPickDirectory: () => void
  onStartProbe: (nextPath?: string) => void
}

/**
 * 探针目标控制舱组件 (移除了与标题栏重复的标题/图标)
 */
export const HeaderHud: React.FC<HeaderHudProps> = ({
  path,
  deep,
  busy,
  onPathChange,
  onDeepChange,
  onPickFile,
  onPickDirectory,
  onStartProbe
}) => {
  return (
    <div className="hud">
      {/* 路径主输入框与浏览选框按钮 */}
      <div className="hud-target-deck">
        <div className="input-wrap hero-input">
          <span className="input-icon" aria-hidden>
            <Search size={15} />
          </span>
          <input
            id="target-path-input"
            className="path-input"
            type="text"
            value={path}
            placeholder={isMacOS
              ? '拖放文件/文件夹到此处，或输入路径（例如 /Users/name/project）...'
              : '拖放文件/文件夹到此处，或输入路径（例如 C:\\path\\to\\target）...'}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onPathChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onStartProbe()
              }
            }}
          />
          {path ? (
            <button
              type="button"
              className="input-clear"
              title="清空路径"
              onClick={() => onPathChange('')}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        {/* 选文件 / 选目录 快捷入口 */}
        <div className="hud-pickers">
          <button type="button" className="btn btn-secondary" onClick={onPickFile} title="选择单文件">
            <HardDrive size={13} />
            选文件
          </button>
          <button type="button" className="btn btn-secondary" onClick={onPickDirectory} title="选择文件夹">
            <Folder size={13} />
            选目录
          </button>
        </div>
      </div>

      {/* 深度扫描与探测执行 */}
      <div className="hud-actions">
        <label
          className="toggle-chip"
          title={isMacOS
            ? '递归扫描目录下的文件使用情况，较大的目录可能耗时较长'
            : '扫描系统句柄和目录引用，耗时相对较长'}
        >
          <input
            type="checkbox"
            checked={deep}
            onChange={(e) => onDeepChange(e.target.checked)}
          />
          <span className="chip-label">深度扫描</span>
        </label>

        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !path.trim()}
          onClick={() => onStartProbe()}
        >
          {busy ? <RefreshCw className="spin" size={13} /> : <Play size={13} />}
          {busy ? '扫描中…' : '开始探测'}
        </button>
      </div>
    </div>
  )
}
