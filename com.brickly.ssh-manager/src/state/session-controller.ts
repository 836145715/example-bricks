import type { BricklyInteraction } from '@syllm/brickly-ui'
import { decodeChunkBytes, hasRuntime, newSessionId, openSession, toBase64, type StreamWriter } from '../brickly'
import type { Host, SessionEvent } from '../types'
import type { ManagerAction } from './manager-state'

type LiveSession = BricklyInteraction<SessionEvent, { sessionId?: string; exitCode?: number }>

export class SessionController {
  private writers = new Map<string, StreamWriter>()
  private pending = new Map<string, Array<Uint8Array | string>>()
  private lives = new Map<string, LiveSession>()
  private outbound = new Map<string, string[]>()
  private pendingResize = new Map<string, { cols: number; rows: number }>()

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

  sendData(sessionId: string, data: string) {
    if (!data) return
    const session = this.lives.get(sessionId)
    if (!session) {
      const queued = this.outbound.get(sessionId) ?? []
      queued.push(data)
      this.outbound.set(sessionId, queued)
      return
    }
    void session.send({ type: 'data', encoding: 'base64', bytes: toBase64(data) }).catch(() => undefined)
  }

  requestCwd(sessionId: string) {
    void this.lives.get(sessionId)?.send({ type: 'cwd' }).catch(() => undefined)
  }

  sendResize(sessionId: string, cols: number, rows: number) {
    const session = this.lives.get(sessionId)
    if (!session) {
      this.pendingResize.set(sessionId, { cols, rows })
      return
    }
    void session.sendLatest('resize', { type: 'resize', cols, rows }).catch(() => undefined)
  }

  attachWriter(sessionId: string, write: StreamWriter) {
    this.writers.set(sessionId, write)
    const queued = this.pending.get(sessionId) ?? []
    this.pending.delete(sessionId)
    for (const bytes of queued) write(bytes)
  }

  close(sessionId: string) {
    this.lives.get(sessionId)?.cancel('user')
    this.forget(sessionId)
  }

  closeAll() {
    for (const sessionId of [...this.lives.keys()]) this.close(sessionId)
  }

  private forget(sessionId: string) {
    this.lives.delete(sessionId)
    this.writers.delete(sessionId)
    this.pending.delete(sessionId)
    this.outbound.delete(sessionId)
    this.pendingResize.delete(sessionId)
  }

  private flushOutbound(sessionId: string) {
    const queued = this.outbound.get(sessionId) ?? []
    this.outbound.delete(sessionId)
    for (const data of queued) this.sendData(sessionId, data)
    const resize = this.pendingResize.get(sessionId)
    this.pendingResize.delete(sessionId)
    if (resize) this.sendResize(sessionId, resize.cols, resize.rows)
  }

  private async open(
    host: Host,
    sessionId: string,
    size: { cols: number; rows: number }
  ): Promise<void> {
    try {
      const session = await openSession(
        {
          hostId: host.id,
          sessionId,
          cols: size.cols,
          rows: size.rows
        },
        (event) => this.onEvent(sessionId, host, event)
      )
      this.lives.set(sessionId, session)
      this.flushOutbound(sessionId)
      await session.result
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
      this.forget(sessionId)
    }
  }

  private onEvent(sessionId: string, host: Host, event: SessionEvent): void {
    if (event.type === 'session') {
      this.dispatch({ type: 'session-updated', sessionId, patch: { status: 'open', message: '' } })
      this.dispatch({ type: 'status', statusText: `${host.name || host.host} 已连接` })
      return
    }
    if (event.type === 'data') {
      this.pushChunk(sessionId, event)
      return
    }
    if (event.type === 'cwd') {
      const path = typeof event.path === 'string' ? event.path : ''
      if (path.startsWith('/')) {
        this.dispatch({ type: 'session-updated', sessionId, patch: { cwd: path } })
      }
      return
    }
    if (event.type === 'status') {
      this.dispatch({
        type: 'session-updated',
        sessionId,
        patch: { status: 'closed', message: '会话已结束' }
      })
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
