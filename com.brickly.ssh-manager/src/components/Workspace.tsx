import type { StreamWriter } from '../brickly'
import type { Host, SidebarTab, Tab, TransferState } from '../types'
import type { SftpController } from '../state/sftp-controller'
import { SessionStage } from './SessionStage'
import { Sidebar } from './Sidebar'
import { TransferBar } from './TransferBar'

export function Workspace({
  sidebarOpen,
  sidebarTab,
  profiles,
  query,
  selectedProfileId,
  tabs,
  activeTabId,
  dropActive,
  destLabel,
  canDrop,
  session,
  profile,
  downloadDir,
  trackCwd,
  transfer,
  sftp,
  onTab,
  onQueryChange,
  onConnect,
  onEdit,
  onCreate,
  onCollapse,
  onTerminalReady,
  onDropActive,
  onUpload,
  onLocalPathPaste,
  onCommandSubmit,
  onDownload,
  onDownloadDir,
  onTrackCwd
}: {
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  profiles: Host[]
  query: string
  selectedProfileId: string | null
  tabs: Tab[]
  activeTabId: string | null
  dropActive: boolean
  destLabel: string
  canDrop: boolean
  session?: Extract<Tab, { kind: 'session' }>
  profile?: Host
  downloadDir: string
  trackCwd: boolean
  transfer: TransferState | null
  sftp: SftpController | null
  onTab: (tab: SidebarTab) => void
  onQueryChange: (query: string) => void
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onCreate: () => void
  onCollapse: () => void
  onTerminalReady: (sessionId: string, api: { write: StreamWriter; cols: number; rows: number }) => void
  onDropActive: (active: boolean) => void
  onUpload: (paths: string[]) => void
  onLocalPathPaste?: (path: string) => void
  onCommandSubmit?: (sessionId: string) => void
  onDownload: (remotePath: string, localDir: string) => void
  onDownloadDir: (dir: string) => void
  onTrackCwd: (track: boolean) => void
}) {
  return (
    <div className={sidebarOpen ? 'workspace' : 'workspace is-collapsed'}>
      {sidebarOpen ? (
        <Sidebar
          tab={sidebarTab}
          profiles={profiles}
          query={query}
          selectedProfileId={selectedProfileId}
          session={session}
          profile={profile}
          downloadDir={downloadDir}
          trackCwd={trackCwd}
          sftp={sftp}
          onTab={onTab}
          onQueryChange={onQueryChange}
          onConnect={onConnect}
          onEdit={onEdit}
          onCreate={onCreate}
          onCollapse={onCollapse}
          onDownload={onDownload}
          onDownloadDir={onDownloadDir}
          onTrackCwd={onTrackCwd}
        />
      ) : null}
      <main className="main">
        <SessionStage
          tabs={tabs}
          activeTabId={activeTabId}
          profiles={profiles}
          dropActive={dropActive}
          destLabel={destLabel}
          canDrop={canDrop}
          onConnect={onConnect}
          onCreate={onCreate}
          onEdit={onEdit}
          onTerminalReady={onTerminalReady}
          onDropActive={onDropActive}
          onUpload={onUpload}
          onLocalPathPaste={onLocalPathPaste}
          onCommandSubmit={onCommandSubmit}
        />
        {transfer ? <TransferBar transfer={transfer} /> : null}
      </main>
    </div>
  )
}
