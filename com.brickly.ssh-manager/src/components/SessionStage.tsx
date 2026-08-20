import type { DragEvent } from 'react'
import { pathsFromFileList } from '../lib/local-paths'
import type { StreamWriter } from '../brickly'
import type { Host, Tab } from '../types'
import { DropMask } from './DropMask'
import { SessionCanvas } from './SessionCanvas'

export function SessionStage({
  tabs,
  activeTabId,
  profiles,
  dropActive,
  destLabel,
  canDrop,
  onConnect,
  onCreate,
  onEdit,
  onTerminalReady,
  onDropActive,
  onUpload,
  onLocalPathPaste,
  onCommandSubmit
}: {
  tabs: Tab[]
  activeTabId: string | null
  profiles: Host[]
  dropActive: boolean
  destLabel: string
  canDrop: boolean
  onConnect: (host: Host) => void
  onCreate: () => void
  onEdit: (host: Host) => void
  onTerminalReady: (sessionId: string, api: { write: StreamWriter; cols: number; rows: number }) => void
  onDropActive: (active: boolean) => void
  onUpload: (paths: string[]) => void
  onLocalPathPaste?: (path: string) => void
  onCommandSubmit?: (sessionId: string) => void
}) {
  const allow = (event: DragEvent) => {
    if (!canDrop) return false
    event.preventDefault()
    return true
  }

  return (
    <div
      className="stage"
      onDragEnter={(event) => {
        if (!allow(event) || !event.dataTransfer.types.includes('Files')) return
        onDropActive(true)
      }}
      onDragOver={(event) => {
        if (!allow(event)) return
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        onDropActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDropActive(false)
        if (!canDrop) return
        onUpload(pathsFromFileList(event.dataTransfer.files))
      }}
    >
      <SessionCanvas
        tabs={tabs}
        activeTabId={activeTabId}
        profiles={profiles}
        onConnect={onConnect}
        onCreate={onCreate}
        onEdit={onEdit}
        onTerminalReady={onTerminalReady}
        onLocalPathPaste={onLocalPathPaste}
        onCommandSubmit={onCommandSubmit}
      />
      {dropActive && canDrop ? <DropMask dest={destLabel} /> : null}
    </div>
  )
}
