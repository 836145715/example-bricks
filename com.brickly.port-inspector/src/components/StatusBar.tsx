import React from 'react'

interface StatusBarProps {
  platform?: string
  method?: string
  brickId?: string
}

function platformLabel(platform?: string) {
  if (!platform || platform === 'waiting') return '未扫描'
  if (platform === 'windows') return 'Windows'
  if (platform === 'macos') return 'macOS'
  return platform
}

function methodLabel(method?: string) {
  if (!method) return '—'
  if (method === 'api') return '系统 API'
  if (method === 'lsof') return 'lsof CLI'
  return method
}

/**
 * 底部状态与环境指示栏
 */
export const StatusBar: React.FC<StatusBarProps> = ({ platform, method, brickId }) => {
  return (
    <footer className="status">
      <div className="status-group">
        <span>
          平台 <b>{platformLabel(platform)}</b>
        </span>
        <span className="sep">|</span>
        <span>
          数据源 <b>{methodLabel(method)}</b>
        </span>
        <span className="sep">|</span>
        <span>
          结束进程 <b>按 PID</b>
        </span>
      </div>

      <div className="status-group right">
        <span className="hotkey-tip">快捷键: 按 Enter 触发扫描</span>
        <span className="sep">|</span>
        <span title={brickId || 'com.brickly.port-inspector'} className="brick-tag">
          {brickId || 'com.brickly.port-inspector'}
        </span>
      </div>
    </footer>
  )
}
