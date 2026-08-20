import { useEffect, useMemo, useReducer, useRef } from 'react'
import { errorMessage, hasBrickly, listHosts, newSessionId, newTabId } from './brickly'
import { Chrome } from './components/Chrome'
import { ConfirmDialog } from './components/ConfirmDialog'
import { HostEditor } from './components/HostEditor'
import { StatusBar } from './components/StatusBar'
import { Workspace } from './components/Workspace'
import { useFileTransfer } from './hooks/useFileTransfer'
import { useHostEditor } from './hooks/useHostEditor'
import { filterProfiles } from './lib/profiles'
import {
  activeProfile,
  activeSession,
  activeTab,
  createInitialState,
  findLiveSession,
  managerReducer,
  openCreateEditor,
  openEditEditor,
  type ManagerAction
} from './state/manager-state'
import { SessionController } from './state/session-controller'
import { SftpController } from './state/sftp-controller'
import type { Host } from './types'

export function App() {
  const [state, dispatch] = useReducer(managerReducer, undefined, createInitialState)
  const sessions = useRef<SessionController | null>(null)
  const sftp = useRef<SftpController | null>(null)
  if (!sessions.current) sessions.current = new SessionController((action: ManagerAction) => dispatch(action))
  if (!sftp.current) sftp.current = new SftpController((action: ManagerAction) => dispatch(action))

  const session = activeSession(state)
  const profile = activeProfile(state)
  const profiles = useMemo(() => filterProfiles(state.profiles, state.query), [state.profiles, state.query])
  const remoteDir = (state.trackCwd && session?.cwd) || session?.sftpDir || ''
  const downloadDir = session?.downloadDir || (profile ? sftp.current.rememberedDownloadDir(profile.id) : '')
  const editor = useHostEditor(state, dispatch, sessions.current)
  const transfer = useFileTransfer({
    session,
    profile,
    remoteDir,
    downloadDir,
    filesOpen: state.sidebarTab === 'files',
    transfer: state.transfer,
    sftp: sftp.current,
    dispatch
  })

  useEffect(() => {
    if (!hasBrickly()) {
      dispatch({ type: 'status', statusText: '当前不在 Brickly 宿主中，无法连接运行时' })
      return
    }
    void listHosts('')
      .then((items) => dispatch({ type: 'profiles-loaded', profiles: items }))
      .catch((error) => dispatch({ type: 'status', statusText: errorMessage(error) }))
  }, [])

  useEffect(() => {
    if (!session || session.status !== 'open' || session.sftpDir) return
    void sftp.current?.list(session.hostId, session.sessionId, '').catch(() => undefined)
  }, [session?.sessionId, session?.status, session?.sftpDir])

  useEffect(() => {
    if (!session || session.status !== 'open' || !state.trackCwd) {
      sessions.current?.stopCwdWatch(session?.sessionId)
      return
    }
    sessions.current?.startCwdWatch(session.sessionId)
    return () => sessions.current?.stopCwdWatch(session.sessionId)
  }, [session?.sessionId, session?.status, state.trackCwd])

  useEffect(() => {
    if (!session || !state.trackCwd || !session.cwd || session.sftpDir === session.cwd) return
    dispatch({ type: 'session-updated', sessionId: session.sessionId, patch: { sftpDir: session.cwd } })
  }, [session?.sessionId, session?.cwd, session?.sftpDir, state.trackCwd])

  const connectHost = (host: Host) => {
    const live = findLiveSession(state.tabs, host.id)
    if (live) {
      dispatch({ type: 'tab-selected', tabId: live.id })
      dispatch({ type: 'profile-selected', profileId: host.id })
      return
    }
    const sessionId = newSessionId()
    const current = activeTab(state)
    dispatch({
      type: 'session-opened',
      replaceTabId: current?.kind === 'start' ? current.id : undefined,
      tab: {
        kind: 'session',
        id: sessionId,
        sessionId,
        hostId: host.id,
        title: host.name || host.host,
        status: 'connecting',
        message: '正在连接…',
        cols: 120,
        rows: 32
      }
    })
    sessions.current?.connect(host, sessionId)
  }

  return (
    <div className="app-root">
      <Chrome
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={(tabId) => dispatch({ type: 'tab-selected', tabId })}
        onClose={(tabId) => {
          const tab = state.tabs.find((item) => item.id === tabId)
          if (tab?.kind === 'session') sessions.current?.close(tab.sessionId)
          dispatch({ type: 'tab-closed', tabId })
        }}
        onNewTab={() => {
          const idle = state.tabs.find((tab) => tab.kind === 'start')
          if (idle) dispatch({ type: 'tab-selected', tabId: idle.id })
          else dispatch({ type: 'start-tab-added', tabId: newTabId('start') })
        }}
      />
      <Workspace
        sidebarOpen={state.sidebarOpen}
        profiles={profiles}
        query={state.query}
        selectedProfileId={state.selectedProfileId}
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        sidebarTab={state.sidebarTab}
        dropActive={state.dropActive}
        destLabel={remoteDir || '家目录'}
        canDrop={session?.status === 'open'}
        session={session}
        profile={profile}
        downloadDir={downloadDir}
        trackCwd={state.trackCwd}
        transfer={state.transfer}
        sftp={sftp.current}
        onTab={(tab) => dispatch({ type: 'sidebar-tab', tab })}
        onQueryChange={(query) => dispatch({ type: 'query-changed', query })}
        onConnect={connectHost}
        onEdit={(host) => dispatch(openEditEditor(host))}
        onCreate={() => dispatch(openCreateEditor())}
        onCollapse={() => dispatch({ type: 'sidebar-toggled' })}
        onTerminalReady={(sessionId, api) => {
          sessions.current?.attachWriter(sessionId, api.write)
          dispatch({ type: 'session-updated', sessionId, patch: { cols: api.cols, rows: api.rows } })
        }}
        onDropActive={(active) => dispatch({ type: 'drop-set', active })}
        onUpload={(paths) => void transfer.upload(paths, remoteDir)}
        onLocalPathPaste={transfer.offerLocalPath}
        onCommandSubmit={(sessionId) => sessions.current?.noteCommandSubmit(sessionId)}
        onDownload={(remotePath, localDir) => void transfer.download(remotePath, localDir)}
        onDownloadDir={(dir) => {
          if (profile && session) sftp.current?.rememberDownloadDir(profile.id, session.sessionId, dir)
        }}
        onTrackCwd={(trackCwd) => dispatch({ type: 'track-cwd', trackCwd })}
      />
      <StatusBar
        session={session}
        profile={profile}
        sidebarOpen={state.sidebarOpen}
        sidebarTab={state.sidebarTab}
        statusText={state.statusText}
        onToggleSidebar={() => dispatch({ type: 'sidebar-toggled' })}
        onTab={(tab) => dispatch({ type: 'sidebar-tab', tab })}
      />
      {state.editor ? (
        <HostEditor
          draft={state.editor.draft}
          mode={state.editor.mode}
          busy={state.busy}
          testMessage={state.editor.testMessage}
          onChange={(patch) => dispatch({ type: 'editor-patched', patch })}
          onSave={() => void editor.save()}
          onTest={() => void editor.test()}
          onDelete={state.editor.mode === 'edit' ? () => void editor.remove() : undefined}
          onClose={() => dispatch({ type: 'editor-closed' })}
        />
      ) : null}
      {state.confirm ? (
        <ConfirmDialog
          confirm={state.confirm}
          onCancel={() => void transfer.resolveConfirm(state.confirm!, false)}
          onConfirm={() => void transfer.resolveConfirm(state.confirm!, true)}
        />
      ) : null}
    </div>
  )
}
