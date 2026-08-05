import React from 'react'
import type { PresetTarget } from '../types'

interface QuickPresetsProps {
  currentPath: string
  onSelectPreset: (path: string) => void
}

const DEFAULT_PRESETS: PresetTarget[] = [
  { label: 'Brickly 项目根目录', path: 'D:\\brick-project', tag: 'Dir' },
  { label: '占用探针根目录', path: 'D:\\brick-project\\example-bricks\\com.brickly.hold-probe', tag: 'Dir' },
  { label: 'node_modules 目录', path: 'D:\\brick-project\\example-bricks\\com.brickly.hold-probe\\node_modules', tag: 'Dir' },
  { label: 'package.json', path: 'D:\\brick-project\\example-bricks\\com.brickly.hold-probe\\package.json', tag: 'File' },
  { label: 'Temporary Temp', path: 'C:\\Windows\\Temp', tag: 'System' }
]

/**
 * 常用预设目标芯片栏组件
 */
export const QuickPresets: React.FC<QuickPresetsProps> = ({
  currentPath,
  onSelectPreset
}) => {
  return (
    <div className="preset-bar">
      <span className="preset-label">快捷测试:</span>
      <div className="preset-chips">
        {DEFAULT_PRESETS.map((preset) => {
          const isActive = currentPath === preset.path
          return (
            <button
              key={preset.path}
              type="button"
              className={`preset-chip${isActive ? ' active' : ''}`}
              title={preset.path}
              onClick={() => onSelectPreset(preset.path)}
            >
              <span>{preset.label}</span>
              {preset.tag ? <span className="chip-tag">{preset.tag}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
