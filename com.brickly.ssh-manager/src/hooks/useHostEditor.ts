import { deleteHost, errorMessage, listHosts, saveHost, testConnection } from '../brickly'
import type { ManagerAction, ManagerState } from '../state/manager-state'
import type { SessionController } from '../state/session-controller'

export function useHostEditor(
  state: ManagerState,
  dispatch: (action: ManagerAction) => void,
  sessions: SessionController | null
) {
  const save = async () => {
    if (!state.editor) return
    dispatch({ type: 'busy', busy: 'save' })
    try {
      const saved = await saveHost(state.editor.draft)
      dispatch({ type: 'status', statusText: `已保存 ${saved.name || saved.host}` })
      dispatch({ type: 'editor-closed' })
      dispatch({ type: 'profile-selected', profileId: saved.id })
      dispatch({ type: 'profiles-loaded', profiles: await listHosts('') })
    } catch (error) {
      dispatch({ type: 'status', statusText: errorMessage(error) })
    } finally {
      dispatch({ type: 'busy', busy: null })
    }
  }

  const remove = async () => {
    const hostId = state.editor?.draft.id
    if (!hostId) return
    dispatch({ type: 'busy', busy: 'delete' })
    try {
      await deleteHost(hostId)
      for (const tab of state.tabs) {
        if (tab.kind === 'session' && tab.hostId === hostId) {
          sessions?.close(tab.sessionId)
          dispatch({ type: 'tab-closed', tabId: tab.id })
        }
      }
      dispatch({ type: 'editor-closed' })
      dispatch({ type: 'status', statusText: 'Profile 已删除' })
      dispatch({ type: 'profiles-loaded', profiles: await listHosts('') })
    } catch (error) {
      dispatch({ type: 'status', statusText: errorMessage(error) })
    } finally {
      dispatch({ type: 'busy', busy: null })
    }
  }

  const test = async () => {
    if (!state.editor) return
    dispatch({ type: 'busy', busy: 'test' })
    try {
      const draft = state.editor.draft
      const result = await testConnection(draft.id ? { hostId: draft.id } : { host: draft })
      dispatch({ type: 'editor-test-message', message: result.message })
      dispatch({ type: 'status', statusText: result.message })
    } catch (error) {
      const message = errorMessage(error)
      dispatch({ type: 'editor-test-message', message })
      dispatch({ type: 'status', statusText: message })
    } finally {
      dispatch({ type: 'busy', busy: null })
    }
  }

  return { save, remove, test }
}
