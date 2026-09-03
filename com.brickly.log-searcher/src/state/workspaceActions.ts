import type {
  FileListStatus,
  FindResult,
  QueryDraft,
  RemoteLogFile,
  ResultWindowState,
  SearchStatePayload,
  ServerConfig,
  ServerFindState
} from '../types'

export type WorkspaceAction =
  | { type: 'SET_SERVERS'; servers: ServerConfig[] }
  | { type: 'SELECT_SERVER'; serverId: string }
  | { type: 'DELETE_SERVER'; serverId: string }
  | { type: 'UPDATE_DRAFT'; serverId: string; draft: Partial<QueryDraft> }
  | { type: 'SET_FILES'; serverId: string; files: RemoteLogFile[]; status: FileListStatus }
  | { type: 'SET_FILE_LIST_STATUS'; serverId: string; status: FileListStatus }
  | { type: 'START_SEARCH'; serverId: string; tabs: string[] }
  | { type: 'UPDATE_SEARCH_STATE'; payload: SearchStatePayload }
  | { type: 'SET_SEARCH_RUN_ID'; serverId: string; runId: string }
  | { type: 'FINISH_SEARCH'; serverId: string; error?: string }
  | { type: 'CANCEL_SEARCH'; serverId: string }
  | { type: 'SET_ACTIVE_TAB'; serverId: string; tabId: string }
  | { type: 'SET_RESULT_WINDOW'; scopeKey: string; window: ResultWindowState }
  | { type: 'SET_RESULT_WINDOW_LOADING'; scopeKey: string; runId: string; loading: boolean }
  | { type: 'SET_RESULT_WINDOW_ERROR'; scopeKey: string; runId: string; error: string }
  | { type: 'CLEAR_SERVER_RESULTS'; serverId: string }
  | { type: 'UPDATE_FIND_STATE'; serverId: string; find: Partial<ServerFindState> }
  | { type: 'SET_FIND_RESULT'; serverId: string; scopeKey: string; result: FindResult | null }
