import clsx from 'clsx'
import { StartPage } from './StartPage'
import { TerminalPane } from './TerminalPane'
import type { Host, Tab } from '../types'
import type { StreamWriter } from '../brickly'

export function SessionCanvas({
  tabs,
  activeTabId,
  profiles,
  onConnect,
  onCreate,
  onEdit,
  onTerminalReady,
  onTerminalInput,
  onTerminalResize,
  onLocalPathPaste
}: {
  tabs: Tab[]
  activeTabId: string | null
  profiles: Host[]
  onConnect: (host: Host) => void
  onCreate: () => void
  onEdit: (host: Host) => void
  onTerminalReady: (sessionId: string, api: { write: StreamWriter; cols: number; rows: number }) => void
  onTerminalInput?: (sessionId: string, data: string) => void
  onTerminalResize?: (sessionId: string, cols: number, rows: number) => void
  onLocalPathPaste?: (path: string) => void
}) {
  return (
    <div className="canvas">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        if (tab.kind === 'start') {
          return (
            <div key={tab.id} className={clsx('canvas-page', active && 'is-visible')}>
              {active ? (
                <StartPage profiles={profiles} onConnect={onConnect} onCreate={onCreate} onEdit={onEdit} />
              ) : null}
            </div>
          )
        }
        return (
          <div key={tab.id} className={clsx('canvas-page', active && 'is-visible')}>
            <TerminalPane
              sessionId={tab.sessionId}
              status={tab.status}
              active={active}
              message={tab.message}
              onReady={(api) => onTerminalReady(tab.sessionId, api)}
              onInput={(data) => onTerminalInput?.(tab.sessionId, data)}
              onResize={(cols, rows) => onTerminalResize?.(tab.sessionId, cols, rows)}
              onLocalPathPaste={onLocalPathPaste}
            />
          </div>
        )
      })}
    </div>
  )
}
