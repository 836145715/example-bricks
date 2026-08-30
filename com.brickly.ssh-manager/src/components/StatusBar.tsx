import { Folder, PanelLeft, Server, TerminalSquare } from 'lucide-react'
import { profileTarget, statusLabel } from '../state/manager-state'
import type { Host, SessionTab, SidebarTab } from '../types'

export function StatusBar({
  session,
  profile,
  sidebarOpen,
  sidebarTab,
  statusText,
  onToggleSidebar,
  onTab
}: {
  session?: SessionTab
  profile?: Host
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  statusText: string
  onToggleSidebar: () => void
  onTab: (tab: SidebarTab) => void
}) {
  return (
    <footer className="statusbar">
      <button type="button" className="status-btn" onClick={onToggleSidebar} title={sidebarOpen ? '收起侧栏' : '打开侧栏'}>
        <PanelLeft size={13} />
        侧栏
      </button>
      <span className="status-item">
        {profile ? profileTarget(profile) : '未选择主机'}
      </span>
      {session ? (
        <span className={`status-item is-${session.status}`}>{statusLabel(session.status)}</span>
      ) : (
        <span className="status-item">就绪</span>
      )}
      {session ? (
        <span className="status-item">
          {session.cols}x{session.rows}
        </span>
      ) : null}
      <span className="status-item status-text">{statusText}</span>
      <span className="status-spacer" />
      <button
        type="button"
        className={sidebarOpen && sidebarTab === 'config' ? 'status-btn is-on' : 'status-btn'}
        onClick={() => onTab('config')}
      >
        <Server size={13} />
        配置
      </button>
      <button
        type="button"
        className={sidebarOpen && sidebarTab === 'files' ? 'status-btn is-on' : 'status-btn'}
        disabled={!session || session.status !== 'open'}
        onClick={() => onTab('files')}
      >
        <Folder size={13} />
        文件
      </button>
      <button
        type="button"
        className={sidebarOpen && sidebarTab === 'exec' ? 'status-btn is-on' : 'status-btn'}
        disabled={!profile}
        onClick={() => onTab('exec')}
      >
        <TerminalSquare size={13} />
        命令
      </button>
    </footer>
  )
}
