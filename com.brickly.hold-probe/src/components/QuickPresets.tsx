import React from 'react'
import type { PresetTarget } from '../types'

interface QuickPresetsProps {
  currentPath: string
  onSelectPreset: (path: string) => void
}

const DEFAULT_PRESETS: PresetTarget[] = navigator.userAgent.includes('Mac')
  ? [
      { label: '应用程序', path: '/Applications', tag: 'Dir' },
      { label: '共享目录', path: '/Users/Shared', tag: 'Dir' },
      { label: '临时目录', path: '/tmp', tag: 'System' },
      { label: '系统日志', path: '/Library/Logs', tag: 'Dir' }
    ]
  : [
      { label: '系统目录', path: 'C:\\Windows', tag: 'Dir' },
      { label: '程序目录', path: 'C:\\Program Files', tag: 'Dir' },
      { label: '临时目录', path: 'C:\\Windows\\Temp', tag: 'System' }
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
