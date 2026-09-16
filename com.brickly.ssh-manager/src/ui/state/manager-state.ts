import {
  emptyHostDraft,
  hostToDraft,
  type ConfirmState,
  type Host,
  type HostDraft,
  type SessionStatus,
  type SidebarTab,
  type Tab,
  type TransferState
} from '../types'

export type EditorState = {
  mode: 'create' | 'edit'
  draft: HostDraft
  testMessage: string
}

export type ManagerState = {
  profiles: Host[]
  query: string
  sidebarOpen: boolean
  selectedProfileId: string | null
  tabs: Tab[]
  activeTabId: string | null
  editor: EditorState | null
  busy: string | null
  statusText: string
  sidebarTab: SidebarTab
  trackCwd: boolean
  transfer: TransferState | null
  dropActive: boolean
  confirm: ConfirmState | null
}

export type ManagerAction =
  | { type: 'profiles-loaded'; profiles: Host[] }
  | { type: 'query-changed'; query: string }
  | { type: 'sidebar-toggled' }
  | { type: 'profile-selected'; profileId: string }
  | { type: 'editor-opened'; mode: 'create' | 'edit'; draft: HostDraft }
  | { type: 'editor-patched'; patch: Partial<HostDraft> }
  | { type: 'editor-test-message'; message: string }
  | { type: 'editor-closed' }
  | { type: 'busy'; busy: string | null }
  | { type: 'status'; statusText: string }
  | { type: 'sidebar-tab'; tab: SidebarTab }
  | { type: 'track-cwd'; trackCwd: boolean }
  | { type: 'transfer-set'; transfer: TransferState | null }
  | { type: 'drop-set'; active: boolean }
  | { type: 'confirm-set'; confirm: ConfirmState | null }
  | { type: 'start-tab-added'; tabId: string }
  | { type: 'tab-selected'; tabId: string }
  | { type: 'tab-closed'; tabId: string }
  | { type: 'session-opened'; tab: Extract<Tab, { kind: 'session' }>; replaceTabId?: string }
  | {
      type: 'session-updated'
      sessionId: string
      patch: Partial<
        Pick<
          Extract<Tab, { kind: 'session' }>,
          'status' | 'message' | 'cols' | 'rows' | 'title' | 'sftpDir' | 'downloadDir' | 'cwd'
        >
      >
    }

const FIRST_START_ID = 'start-home'

export function createInitialState(): ManagerState {
  return {
    profiles: [],
    query: '',
    sidebarOpen: true,
    selectedProfileId: null,
    tabs: [{ kind: 'start', id: FIRST_START_ID }],
    activeTabId: FIRST_START_ID,
    editor: null,
    busy: null,
    statusText: '准备就绪',
    sidebarTab: 'config',
    trackCwd: readTrackCwd(),
    transfer: null,
    dropActive: false,
    confirm: null
  }
}

export function managerReducer(state: ManagerState, action: ManagerAction): ManagerState {
  switch (action.type) {
    case 'profiles-loaded':
      return { ...state, profiles: action.profiles }
    case 'query-changed':
      return { ...state, query: action.query }
    case 'sidebar-toggled':
      return { ...state, sidebarOpen: !state.sidebarOpen }
    case 'profile-selected':
      return { ...state, selectedProfileId: action.profileId }
    case 'editor-opened':
      return {
        ...state,
        editor: { mode: action.mode, draft: action.draft, testMessage: '' },
        selectedProfileId: action.draft.id ?? state.selectedProfileId
      }
    case 'editor-patched':
      if (!state.editor) return state
      return { ...state, editor: { ...state.editor, draft: { ...state.editor.draft, ...action.patch } } }
    case 'editor-test-message':
      if (!state.editor) return state
      return { ...state, editor: { ...state.editor, testMessage: action.message } }
    case 'editor-closed':
      return { ...state, editor: null }
    case 'busy':
      return { ...state, busy: action.busy }
    case 'status':
      return { ...state, statusText: action.statusText }
    case 'sidebar-tab':
      return { ...state, sidebarOpen: true, sidebarTab: action.tab }
    case 'track-cwd':
      writeTrackCwd(action.trackCwd)
      return { ...state, trackCwd: action.trackCwd }
    case 'transfer-set':
      return { ...state, transfer: action.transfer }
    case 'drop-set':
      return { ...state, dropActive: action.active }
    case 'confirm-set':
      return { ...state, confirm: action.confirm }
    case 'start-tab-added': {
      const tab: Tab = { kind: 'start', id: action.tabId }
      return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id }
    }
    case 'tab-selected':
      return { ...state, activeTabId: action.tabId }
    case 'tab-closed': {
      const remaining = state.tabs.filter((tab) => tab.id !== action.tabId)
      if (remaining.length === 0) {
        return { ...state, tabs: [{ kind: 'start', id: FIRST_START_ID }], activeTabId: FIRST_START_ID }
      }
      const activeTabId =
        state.activeTabId === action.tabId ? remaining[remaining.length - 1].id : state.activeTabId
      return { ...state, tabs: remaining, activeTabId }
    }
    case 'session-opened': {
      const existing = state.tabs.find((tab) => tab.kind === 'session' && tab.sessionId === action.tab.sessionId)
      if (existing) {
        return { ...state, activeTabId: existing.id, selectedProfileId: action.tab.hostId }
      }
      const tabs = action.replaceTabId
        ? state.tabs.map((tab) => (tab.id === action.replaceTabId ? action.tab : tab))
        : [...state.tabs, action.tab]
      return {
        ...state,
        tabs,
        activeTabId: action.tab.id,
        selectedProfileId: action.tab.hostId
      }
    }
    case 'session-updated':
      return {
        ...state,
        tabs: state.tabs.map((tab) => {
          if (tab.kind !== 'session' || tab.sessionId !== action.sessionId) return tab
          if (tab.status === 'error' && action.patch.status === 'closed') return tab
          return { ...tab, ...action.patch }
        })
      }
    default:
      return state
  }
}

export function findLiveSession(tabs: Tab[], hostId: string): Extract<Tab, { kind: 'session' }> | undefined {
  return tabs.find(
    (tab): tab is Extract<Tab, { kind: 'session' }> =>
      tab.kind === 'session' && tab.hostId === hostId && (tab.status === 'open' || tab.status === 'connecting')
  )
}

export function activeTab(state: ManagerState): Tab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeTabId)
}

export function activeSession(state: ManagerState): Extract<Tab, { kind: 'session' }> | undefined {
  const tab = activeTab(state)
  return tab?.kind === 'session' ? tab : undefined
}

export function activeProfile(state: ManagerState): Host | undefined {
  const session = activeSession(state)
  const profileId = session?.hostId ?? state.selectedProfileId
  return state.profiles.find((item) => item.id === profileId)
}

export function statusLabel(status: SessionStatus): string {
  if (status === 'connecting') return '连接中'
  if (status === 'open') return '已连接'
  if (status === 'error') return '失败'
  return '已断开'
}

export function profileLabel(host: Host): string {
  return host.name || host.host
}

export function profileTarget(host: Pick<Host, 'user' | 'host' | 'port'>): string {
  return `${host.user}@${host.host}:${host.port || 22}`
}

const TRACK_KEY = 'ssh-manager:track-cwd'

function readTrackCwd(): boolean {
  try {
    return localStorage.getItem(TRACK_KEY) === '1'
  } catch {
    return false
  }
}

function writeTrackCwd(value: boolean) {
  try {
    localStorage.setItem(TRACK_KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function openCreateEditor(): ManagerAction {
  return { type: 'editor-opened', mode: 'create', draft: emptyHostDraft() }
}

export function openEditEditor(host: Host): ManagerAction {
  return { type: 'editor-opened', mode: 'edit', draft: hostToDraft(host) }
}
