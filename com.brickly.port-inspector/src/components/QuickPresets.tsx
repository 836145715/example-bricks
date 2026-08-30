import React from 'react'
import type { PresetPort } from '../types'

const COMMON_PORTS: PresetPort[] = [
  { port: 3000, label: '3000', tag: 'Web / React' },
  { port: 5173, label: '5173', tag: 'Vite / Vue' },
  { port: 8080, label: '8080', tag: 'Java / Tomcat' },
  { port: 80, label: '80', tag: 'HTTP' },
  { port: 443, label: '443', tag: 'HTTPS' },
  { port: 3306, label: '3306', tag: 'MySQL' },
  { port: 5432, label: '5432', tag: 'PostgreSQL' },
  { port: 6379, label: '6379', tag: 'Redis' },
  { port: 27017, label: '27017', tag: 'MongoDB' }
]

interface QuickPresetsProps {
  currentPort: string
  disabled: boolean
  onSelectPort: (port: number) => void
}

/**
 * 常用开发端口快捷点选芯片组
 */
export const QuickPresets: React.FC<QuickPresetsProps> = ({ currentPort, disabled, onSelectPort }) => {
  return (
    <div className="preset-bar" aria-label="常用端口预设">
      <span className="preset-label">快捷点查：</span>
      <div className="preset-chips">
        {COMMON_PORTS.map((item) => {
          const isActive = currentPort === String(item.port)
          return (
            <button
              key={item.port}
              type="button"
              className={`preset-chip ${isActive ? 'active' : ''}`}
              disabled={disabled}
              title={`扫描端口 ${item.port} (${item.tag})`}
              onClick={() => onSelectPort(item.port)}
            >
              <span className="chip-port">{item.label}</span>
              <span className="chip-tag">{item.tag}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
