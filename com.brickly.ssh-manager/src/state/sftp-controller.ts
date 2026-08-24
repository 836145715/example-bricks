import {
  asSftpProgress,
  asSftpResult,
  errorMessage,
  interactSftpDownload,
  interactSftpUpload,
  sftpList
} from '../brickly'
import { progressToTransfer, transferLine } from '../lib/format'
import type { ManagerAction } from './manager-state'
import type { SftpListResult, SftpProgressEvent, StreamHandle, TransferState } from '../types'

const DOWNLOAD_KEY = 'ssh-manager:download-dir'

export class SftpController {
  private handle: StreamHandle | null = null
  private hideTimer: number | null = null

  constructor(private readonly dispatch: (action: ManagerAction) => void) {}

  async list(hostId: string, sessionId?: string, path?: string): Promise<SftpListResult> {
    const result = await sftpList({ hostId, sessionId, path })
    if (sessionId && result.path) {
      this.dispatch({ type: 'session-updated', sessionId, patch: { sftpDir: result.path } })
    }
    return result
  }

  rememberedDownloadDir(hostId: string): string {
    try {
      return localStorage.getItem(`${DOWNLOAD_KEY}:${hostId}`) ?? ''
    } catch {
      return ''
    }
  }

  rememberDownloadDir(hostId: string, sessionId: string, dir: string) {
    try {
      localStorage.setItem(`${DOWNLOAD_KEY}:${hostId}`, dir)
    } catch {
      /* ignore */
    }
    this.dispatch({ type: 'session-updated', sessionId, patch: { downloadDir: dir } })
  }

  async uploadAll(input: {
    hostId: string
    sessionId?: string
    localPaths: string[]
    remoteDir: string
    overwrite?: boolean
  }): Promise<void> {
    for (const localPath of input.localPaths) {
      await this.uploadOne({ ...input, localPath })
    }
  }

  uploadOne(input: {
    hostId: string
    sessionId?: string
    localPath: string
    remoteDir: string
    overwrite?: boolean
  }): Promise<void> {
    return this.runTransfer('upload', input.remoteDir, () =>
      interactSftpUpload({
        hostId: input.hostId,
        sessionId: input.sessionId,
        localPath: input.localPath,
        remoteDir: input.remoteDir || undefined,
        overwrite: input.overwrite
      })
    )
  }

  download(input: {
    hostId: string
    sessionId?: string
    remotePath: string
    localDir: string
    overwrite?: boolean
  }): Promise<void> {
    return this.runTransfer('download', input.remotePath, () =>
      interactSftpDownload({
        hostId: input.hostId,
        sessionId: input.sessionId,
        remotePath: input.remotePath,
        localDir: input.localDir,
        overwrite: input.overwrite
      })
    )
  }

  private async runTransfer(
    mode: 'upload' | 'download',
    remoteDir: string,
    start: () => ReturnType<typeof interactSftpUpload>
  ): Promise<void> {
    this.clearHide()
    this.setTransfer({
      status: 'running',
      phase: 'connecting',
      bytes: 0,
      remoteDir,
      message: ''
    })
    const session = await start()
    this.handle = {
      cancel() {
        session.cancel('CANCELLED')
      }
    }
    try {
      const pump = this.pumpProgress(session, remoteDir)
      await session.closeInput()
      const result = asSftpResult(await session.result)
      await pump
      if (result) this.finishOk(mode, result.remotePath, remoteDir)
    } catch (error) {
      this.setTransfer({
        status: 'error',
        phase: 'error',
        bytes: 0,
        remoteDir,
        message: errorMessage(error)
      })
      throw error
    } finally {
      this.handle = null
    }
  }

  private async pumpProgress(
    session: { nextEvent(): Promise<SftpProgressEvent | undefined> },
    remoteDir: string
  ): Promise<void> {
    while (true) {
      const event = await session.nextEvent()
      if (event === undefined) return
      if (event.type !== 'progress') continue
      const progress = asSftpProgress(event)
      if (!progress) continue
      this.setTransfer(progressToTransfer(progress, { remoteDir }))
    }
  }

  private finishOk(mode: 'upload' | 'download', remotePath: string, remoteDir: string) {
    this.setTransfer({
      status: 'ok',
      phase: mode,
      bytes: 0,
      percent: 100,
      remoteDir,
      remotePath,
      currentPath: remotePath,
      message: ''
    })
    this.clearHide()
    this.hideTimer = window.setTimeout(() => {
      this.dispatch({ type: 'transfer-set', transfer: null })
      this.dispatch({ type: 'status', statusText: '准备就绪' })
    }, 1000)
  }

  private setTransfer(transfer: TransferState) {
    this.dispatch({ type: 'transfer-set', transfer })
    this.dispatch({ type: 'status', statusText: transferLine(transfer) })
  }

  private clearHide() {
    if (this.hideTimer != null) {
      window.clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }
}
