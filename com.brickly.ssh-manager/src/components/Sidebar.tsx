import { Folder, PanelLeftClose, Server, TerminalSquare } from 'lucide-react'
import clsx from 'clsx'
import type { Host, SessionTab, SidebarTab } from '../types'
import type { SftpController } from '../state/sftp-controller'
import { ExecPanel } from './ExecPanel'
import { ProfileSidebar } from './ProfileSidebar'
import { SftpPanel } from './SftpPanel'

const TABS: Array<{ id: SidebarTab; label: string; icon: typeof Server }> = [
  { id: 'config', label: '配置', icon: Server },
  { id: 'files', label: '文件', icon: Folder },
  { id: 'exec', label: '命令', icon: TerminalSquare }
]

export function Sidebar({
  tab,
  profiles,
  query,
  selectedProfileId,
  session,
  profile,
  downloadDir,
  trackCwd,
  sftp,
  onTab,
  onQueryChange,
  onConnect,
  onEdit,
  onCreate,
  onCollapse,
  onDownload,
  onDownloadDir,
  onTrackCwd
}: {
  tab: SidebarTab
  profiles: Host[]
  query: string
  selectedProfileId: string | null
  session?: SessionTab
  profile?: Host
  downloadDir: string
  trackCwd: boolean
  sftp: SftpController | null
  onTab: (tab: SidebarTab) => void
  onQueryChange: (query: string) => void
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onCreate: () => void
  onCollapse: () => void
  onDownload: (remotePath: string, localDir: string) => void
  onDownloadDir: (dir: string) => void
  onTrackCwd: (track: boolean) => void
}) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-tabs">
        {TABS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              className={clsx('sidebar-tab', tab === item.id && 'is-active')}
              onClick={() => onTab(item.id)}
            >
              <Icon size={13} />
              {item.label}
            </button>
          )
        })}
        <button type="button" className="icon-btn sidebar-collapse" title="收起侧栏" onClick={onCollapse}>
          <PanelLeftClose size={14} />
        </button>
      </nav>
      <div className="sidebar-body">
        {tab === 'config' ? (
          <ProfileSidebar
            profiles={profiles}
            query={query}
            selectedProfileId={selectedProfileId}
            onQueryChange={onQueryChange}
            onConnect={onConnect}
            onEdit={onEdit}
            onCreate={onCreate}
          />
        ) : null}
        {tab === 'files' ? (
          session?.status === 'open' && profile && sftp ? (
            <SftpPanel
              host={profile}
              session={session}
              downloadDir={downloadDir}
              trackCwd={trackCwd}
              controller={sftp}
              onDownloadDir={onDownloadDir}
              onDownload={onDownload}
              onTrackCwd={onTrackCwd}
            />
          ) : (
            <div className="empty-block">
              <p>先连接一台主机，再管理远端文件</p>
            </div>
          )
        ) : null}
        {tab === 'exec' ? (
          profile ? (
            <ExecPanel host={profile} />
          ) : (
            <div className="empty-block">
              <p>先选择或连接一台主机</p>
            </div>
          )
        ) : null}
      </div>
    </aside>
  )
}
