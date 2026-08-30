import { formatBytes } from '../lib/format'
import type { SftpEntry } from '../types'

export function SftpFileList({
  entries,
  selected,
  empty,
  onSelect,
  onOpen
}: {
  entries: SftpEntry[]
  selected: SftpEntry | null
  empty: boolean
  onSelect: (entry: SftpEntry) => void
  onOpen: (entry: SftpEntry) => void
}) {
  return (
    <ul className="sftp-list">
      {entries.map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            className={selected?.path === entry.path ? 'is-selected' : undefined}
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
          >
            <span>
              {entry.kind === 'dir' ? '📁' : '📄'} {entry.name}
            </span>
            <em>{entry.kind === 'dir' ? '' : formatBytes(entry.size)}</em>
          </button>
        </li>
      ))}
      {empty ? <li className="sftp-empty">空目录</li> : null}
    </ul>
  )
}
