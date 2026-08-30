import React from 'react'

interface StatusBarProps {
  holdersCount: number
}

/**
 * 底部状态与快捷键提示组件
 */
export const StatusBar: React.FC<StatusBarProps> = ({ holdersCount }) => {
  const isMacOS = navigator.userAgent.includes('Mac')
  return (
    <footer className="status">
      <div className="status-group">
        <span>
          系统引擎: <b>{isMacOS ? 'macOS lsof' : 'Win32 Restart Manager + Handle API'}</b>
        </span>
        <span className="sep">|</span>
        <span>
          平台: <b>{isMacOS ? 'mac-x64 / mac-arm64' : 'win-x64 / win-arm64'}</b>
        </span>
        <span className="sep">|</span>
        <span>
          当前锁定: <b>{holdersCount} 个进程</b>
        </span>
      </div>

      <div className="status-group right">
        <span className="hotkey-tip">快捷键: 按 <b>Enter</b> 触发扫描 · 按 <b>Esc</b> 关闭详情</span>
        <span className="sep">|</span>
        <span className="brick-tag">
          {window.brickly?.ref?.brickId ?? 'com.brickly.hold-probe'}
        </span>
      </div>
    </footer>
  )
}
