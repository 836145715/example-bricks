import {
  asSftpProgress,
  asSftpResult,
  errorMessage,
  sftpList,
  streamSftpDownload,
  streamSftpUpload
} from '../brickly'
import { progressToTransfer, transferLine } from '../lib/format'
import type { ManagerAction } from './manager-state'
import type { SftpListResult, StreamHandle, TransferState } from '../types'

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
    return this.runTransfer('upload', input.remoteDir, (onProgress) =>
      streamSftpUpload(
        {
          hostId: input.hostId,
          sessionId: input.sessionId,
          localPath: input.localPath,
          remoteDir: input.remoteDir || undefined,
          overwrite: input.overwrite
        },
        onProgress
      )
    )
  }

  download(input: {
    hostId: string
    sessionId?: string
    remotePath: string
    localDir: string
    overwrite?: boolean
  }): Promise<void> {
    return this.runTransfer('download', input.remotePath, (onProgress) =>
      streamSftpDownload(
        {
          hostId: input.hostId,
          sessionId: input.sessionId,
          remotePath: input.remotePath,
          localDir: input.localDir,
          overwrite: input.overwrite
        },
        onProgress
      )
    )
  }

  private runTransfer(
    mode: 'upload' | 'download',
    remoteDir: string,
    start: (callbacks: Parameters<NonNullable<Window['brickly']>['stream']>[2]) => StreamHandle
  ): Promise<void> {
    this.clearHide()
    this.setTransfer({
      status: 'running',
      phase: 'connecting',
      bytes: 0,
      remoteDir,
      message: ''
    })
    return new Promise((resolve, reject) => {
      let settled = false
      this.handle = start({
        onChunk: (name, chunk) => {
          if (name !== 'progress') return
          const progress = asSftpProgress(chunk)
          if (!progress) return
          this.setTransfer(progressToTransfer(progress, { remoteDir }))
        },
        onOutput: (name, value) => {
          if (name !== 'result') return
          const result = asSftpResult(value)
          if (result) this.finishOk(mode, result.remotePath, remoteDir)
        },
        onResult: (value) => {
          const result = asSftpResult(value)
          if (result) this.finishOk(mode, result.remotePath, remoteDir)
          if (!settled) {
            settled = true
            resolve()
          }
        },
        onError: (error) => {
          this.setTransfer({
            status: 'error',
            phase: 'error',
            bytes: 0,
            remoteDir,
            message: error.message || errorMessage(error)
          })
          if (!settled) {
            settled = true
            reject(error)
          }
        },
        onDone: () => {
          this.handle = null
          if (!settled) {
            settled = true
            resolve()
          }
        }
      })
    })
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
