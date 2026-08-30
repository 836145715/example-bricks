import { useEffect, useRef } from 'react'
import { errorMessage } from '../brickly'
import { classifyPaste } from '../lib/local-paths'
import { isUiField } from '../lib/terminal-keys'
import type { ManagerAction } from '../state/manager-state'
import type { SessionController } from '../state/session-controller'
import type { SftpController } from '../state/sftp-controller'
import type { ConfirmState, Host, SessionTab, TransferState } from '../types'

type UploadOp = { mode: 'upload'; paths: string[]; remoteDir: string; pasteText?: string }
type DownloadOp = { mode: 'download'; remotePath: string; localDir: string; remoteDir: string }
type PendingOp = UploadOp | DownloadOp

export function useFileTransfer({
  session,
  profile,
  remoteDir,
  downloadDir,
  filesOpen,
  transfer,
  sftp,
  sessions,
  dispatch
}: {
  session?: SessionTab
  profile?: Host
  remoteDir: string
  downloadDir: string
  filesOpen: boolean
  transfer: TransferState | null
  sftp: SftpController | null
  sessions: SessionController | null
  dispatch: (action: ManagerAction) => void
}) {
  const pending = useRef<PendingOp | null>(null)

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!session || session.status !== 'open' || transfer?.status === 'running') return
      if (isUiField(event.target)) return
      const intent = classifyPaste({
        files: event.clipboardData?.files,
        text: event.clipboardData?.getData('text') ?? ''
      })
      if (intent.kind === 'text') return
      event.preventDefault()
      event.stopPropagation()
      if (intent.kind === 'files') {
        void upload(intent.paths, remoteDir)
        return
      }
      pending.current = { mode: 'upload', paths: [intent.path], remoteDir, pasteText: intent.path }
      dispatch({ type: 'confirm-set', confirm: { kind: 'path', path: intent.path, remoteDir } })
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [session, remoteDir, transfer?.status])

  const upload = async (paths: string[], dest: string, overwrite = false) => {
    if (!session || !profile || paths.length === 0) return
    if (transfer?.status === 'running') {
      dispatch({ type: 'status', statusText: '正在传输，请稍后再试' })
      return
    }
    pending.current = { mode: 'upload', paths, remoteDir: dest }
    try {
      await sftp?.uploadAll({
        hostId: profile.id,
        sessionId: session.sessionId,
        localPaths: paths,
        remoteDir: dest,
        overwrite
      })
      if (filesOpen) {
        await sftp?.list(profile.id, session.sessionId, dest || session.sftpDir).catch(() => undefined)
      }
    } catch (error) {
      const record = error as { code?: string }
      if (record.code === 'SFTP_EXISTS') {
        dispatch({
          type: 'confirm-set',
          confirm: { kind: 'overwrite', localPath: paths[0], remoteDir: dest, mode: 'upload' }
        })
        return
      }
      dispatch({ type: 'status', statusText: errorMessage(error) })
    }
  }

  const download = async (remotePath: string, localDir = downloadDir, overwrite = false) => {
    if (!session || !profile || !localDir) return
    pending.current = { mode: 'download', remotePath, localDir, remoteDir }
    try {
      await sftp?.download({
        hostId: profile.id,
        sessionId: session.sessionId,
        remotePath,
        localDir,
        overwrite
      })
    } catch (error) {
      const record = error as { code?: string }
      if (record.code === 'SFTP_EXISTS') {
        dispatch({
          type: 'confirm-set',
          confirm: { kind: 'overwrite', remotePath, remoteDir, mode: 'download' }
        })
      }
    }
  }

  const offerLocalPath = (path: string) => {
    if (!session || session.status !== 'open' || transfer?.status === 'running') return
    pending.current = { mode: 'upload', paths: [path], remoteDir, pasteText: path }
    dispatch({ type: 'confirm-set', confirm: { kind: 'path', path, remoteDir } })
  }

  const resolveConfirm = async (confirm: ConfirmState, accepted: boolean) => {
    dispatch({ type: 'confirm-set', confirm: null })
    const op = pending.current
    if (!accepted) {
      if (confirm.kind === 'path' && session && op?.mode === 'upload' && op.pasteText) {
        sessions?.sendData(session.sessionId, op.pasteText)
      }
      pending.current = null
      return
    }
    if (confirm.kind === 'path' && op?.mode === 'upload') {
      await upload(op.paths, op.remoteDir)
      return
    }
    if (confirm.kind === 'overwrite' && op?.mode === 'upload') {
      await upload(op.paths, op.remoteDir, true)
      return
    }
    if (confirm.kind === 'overwrite' && op?.mode === 'download') {
      await download(op.remotePath, op.localDir, true)
    }
  }

  return { upload, download, offerLocalPath, resolveConfirm }
}
