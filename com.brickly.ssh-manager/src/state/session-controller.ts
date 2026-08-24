import {
  closeSession,
  decodeChunkBytes,
  hasRuntime,
  newSessionId,
  openSession,
  sessionCwd,
  type StreamWriter
} from '../brickly'
import type { Host, SessionEvent, StreamHandle } from '../types'
import type { ManagerAction } from './manager-state'

const CWD_AFTER_ENTER_MS = 350

export class SessionController {
  private writers = new Map<string, StreamWriter>()
  private pending = new Map<string, Array<Uint8Array | string>>()
  private handles = new Map<string, StreamHandle>()
  private cwdWatch = new Set<string>()
  private cwdDelay = new Map<string, number>()
  private cwdBusy = new Set<string>()
  private cwdQueued = new Set<string>()
  private lastCwd = new Map<string, string>()

  constructor(private readonly dispatch: (action: ManagerAction) => void) {}

  connect(host: Host, sessionId = newSessionId(), size = { cols: 120, rows: 32 }): string | null {
    if (!hasRuntime()) {
      this.dispatch({ type: 'status', statusText: 'SSH Runtime 尚未就绪' })
      return null
    }

    this.dispatch({
      type: 'session-updated',
      sessionId,
      patch: { status: 'connecting', message: '正在连接…' }
    })
    this.dispatch({ type: 'status', statusText: `正在连接 ${host.name || host.host}` })

    void this.open(host, sessionId, size)
    return sessionId
  }

  startCwdWatch(sessionId: string) {
    if (this.cwdWatch.has(sessionId)) return
    this.cwdWatch.add(sessionId)
    void this.refreshCwd(sessionId)
    this.cwdDelay.set(
      sessionId,
      window.setTimeout(() => {
        this.cwdDelay.delete(sessionId)
        void this.refreshCwd(sessionId)
      }, 600)
    )
  }

  stopCwdWatch(sessionId?: string) {
    if (!sessionId) return
    const delay = this.cwdDelay.get(sessionId)
    if (delay) window.clearTimeout(delay)
    this.cwdDelay.delete(sessionId)
    this.cwdWatch.delete(sessionId)
    this.cwdBusy.delete(sessionId)
    this.cwdQueued.delete(sessionId)
  }

  noteCommandSubmit(sessionId: string) {
    if (!this.cwdWatch.has(sessionId)) return
    const prev = this.cwdDelay.get(sessionId)
    if (prev) window.clearTimeout(prev)
    this.cwdDelay.set(
      sessionId,
      window.setTimeout(() => {
        this.cwdDelay.delete(sessionId)
        void this.refreshCwd(sessionId)
      }, CWD_AFTER_ENTER_MS)
    )
  }

  attachWriter(sessionId: string, write: StreamWriter) {
    this.writers.set(sessionId, write)
    const queued = this.pending.get(sessionId) ?? []
    this.pending.delete(sessionId)
    for (const bytes of queued) write(bytes)
  }

  close(sessionId: string) {
    this.stopCwdWatch(sessionId)
    this.handles.get(sessionId)?.cancel()
    this.handles.delete(sessionId)
    this.writers.delete(sessionId)
    this.pending.delete(sessionId)
    this.lastCwd.delete(sessionId)
    void closeSession(sessionId)
  }

  closeAll() {
    for (const sessionId of [...this.handles.keys()]) this.close(sessionId)
  }

  private async open(
    host: Host,
    sessionId: string,
    size: { cols: number; rows: number }
  ): Promise<void> {
    try {
      const session = await openSession({
        hostId: host.id,
        sessionId,
        cols: size.cols,
        rows: size.rows
      })
      this.handles.set(sessionId, {
        cancel() {
          session.cancel('CANCELLED')
        }
      })
      const pump = this.pump(sessionId, host, session)
      await session.closeInput()
      await session.result
      await pump
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/CANCELLED/i.test(message)) return
      this.dispatch({
        type: 'session-updated',
        sessionId,
        patch: { status: 'error', message }
      })
      this.dispatch({ type: 'status', statusText: message })
    } finally {
      this.handles.delete(sessionId)
    }
  }

  private async pump(
    sessionId: string,
    host: Host,
    session: { nextEvent(): Promise<SessionEvent | undefined> }
  ): Promise<void> {
    while (true) {
      const event = await session.nextEvent()
      if (event === undefined) return
      if (event.type === 'session') {
        this.dispatch({ type: 'session-updated', sessionId, patch: { status: 'open', message: '' } })
        this.dispatch({ type: 'status', statusText: `${host.name || host.host} 已连接` })
        continue
      }
      if (event.type === 'data') {
        this.pushChunk(sessionId, event)
        continue
      }
      if (event.type === 'status') {
        this.dispatch({
          type: 'session-updated',
          sessionId,
          patch: { status: 'closed', message: '会话已结束' }
        })
      }
    }
  }

  private async refreshCwd(sessionId: string) {
    if (!this.cwdWatch.has(sessionId)) return
    if (this.cwdBusy.has(sessionId)) {
      this.cwdQueued.add(sessionId)
      return
    }
    this.cwdBusy.add(sessionId)
    try {
      const path = await sessionCwd(sessionId)
      if (!path || this.lastCwd.get(sessionId) === path) return
      this.lastCwd.set(sessionId, path)
      this.dispatch({ type: 'session-updated', sessionId, patch: { cwd: path } })
    } catch {
      return
    } finally {
      this.cwdBusy.delete(sessionId)
      if (this.cwdQueued.has(sessionId) && this.cwdWatch.has(sessionId)) {
        this.cwdQueued.delete(sessionId)
        void this.refreshCwd(sessionId)
      }
    }
  }

  private pushChunk(sessionId: string, chunk: unknown) {
    const bytes = decodeChunkBytes(chunk)
    if (!bytes) return
    const writer = this.writers.get(sessionId)
    if (writer) {
      writer(bytes)
      return
    }
    const queued = this.pending.get(sessionId) ?? []
    queued.push(bytes)
    this.pending.set(sessionId, queued)
  }
}
