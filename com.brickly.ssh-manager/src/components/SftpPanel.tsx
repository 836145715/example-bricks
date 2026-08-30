import { ChevronUp, Download, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorMessage, pickDirectory } from '../brickly'
import { parentPath, SftpCrumbs } from './SftpCrumbs'
import { SftpFileList } from './SftpFileList'
import type { Host, SessionTab, SftpEntry } from '../types'
import type { SftpController } from '../state/sftp-controller'

export function SftpPanel({
  host,
  session,
  downloadDir,
  trackCwd,
  controller,
  onDownloadDir,
  onDownload,
  onTrackCwd
}: {
  host: Host
  session: SessionTab
  downloadDir: string
  trackCwd: boolean
  controller: SftpController
  onDownloadDir: (dir: string) => void
  onDownload: (remotePath: string, localDir: string) => void
  onTrackCwd: (track: boolean) => void
}) {
  const [path, setPath] = useState(session.sftpDir ?? '')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [selected, setSelected] = useState<SftpEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async (next = path) => {
    setBusy(true)
    setError('')
    try {
      const result = await controller.list(host.id, session.sessionId, next || undefined)
      setPath(result.path)
      setEntries(result.entries ?? [])
      setSelected(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load(session.sftpDir ?? '')
  }, [session.sessionId])

  useEffect(() => {
    if (!trackCwd || !session.cwd || session.cwd === path) return
    void load(session.cwd)
  }, [trackCwd, session.cwd])

  const crumbs = path.split('/').filter(Boolean)

  return (
    <div className="sftp-pane">
      <header className="sftp-head">
        <div>
          <h3>文件管理</h3>
          <p>{trackCwd && session.cwd ? session.cwd : host.name || host.host}</p>
        </div>
        <label className={trackCwd ? 'track-switch is-on' : 'track-switch'} title="终端改目录时同步文件列表">
          <input
            type="checkbox"
            checked={trackCwd}
            onChange={(event) => onTrackCwd(event.target.checked)}
          />
          追踪
        </label>
      </header>
      <div className="sftp-toolbar">
        <button type="button" className="icon-btn" disabled={crumbs.length === 0} onClick={() => void load(parentPath(path))} title="上级">
          <ChevronUp size={14} />
        </button>
        <button type="button" className="icon-btn" onClick={() => void load(path)} title="刷新">
          {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        </button>
        <SftpCrumbs path={path} onOpen={(next) => void load(next)} />
      </div>
      <SftpFileList
        entries={entries}
        selected={selected}
        empty={!busy && entries.length === 0}
        onSelect={setSelected}
        onOpen={(entry) => {
          if (entry.kind === 'dir') void load(entry.path)
          else setSelected(entry)
        }}
      />
      <footer>
        <button
          type="button"
          className="ghost-btn"
          onClick={async () => {
            const dir = await pickDirectory(downloadDir || undefined)
            if (dir) onDownloadDir(dir)
          }}
        >
          <FolderOpen size={13} />
          {downloadDir ? '目录' : '下载目录'}
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={!selected}
          onClick={async () => {
            if (!selected) return
            let dir = downloadDir
            if (!dir) {
              dir = (await pickDirectory()) ?? ''
              if (!dir) return
              onDownloadDir(dir)
            }
            onDownload(selected.path, dir)
          }}
        >
          <Download size={13} />
          下载
        </button>
      </footer>
      {downloadDir ? <p className="sftp-download-dir">{downloadDir}</p> : null}
      {error ? <p className="sftp-error">{error}</p> : null}
    </div>
  )
}
