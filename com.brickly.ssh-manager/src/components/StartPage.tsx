import { Plus, TerminalSquare } from 'lucide-react'
import { profileLabel, profileTarget } from '../state/manager-state'
import type { Host } from '../types'

export function StartPage({
  profiles,
  onConnect,
  onCreate,
  onEdit
}: {
  profiles: Host[]
  onConnect: (host: Host) => void
  onCreate: () => void
  onEdit: (host: Host) => void
}) {
  return (
    <section className="start-page">
      <div className="start-copy">
        <h1>新连接</h1>
        <p>选择一个 Profile 打开终端，或先建一台主机。</p>
      </div>
      <div className="start-actions">
        <button type="button" className="primary-btn" onClick={onCreate}>
          <Plus size={14} />
          新建 Profile
        </button>
      </div>
      <div className="start-list">
        {profiles.length === 0 ? (
          <p className="start-empty">还没有保存的主机。</p>
        ) : (
          profiles.map((host) => (
            <article key={host.id} className="start-item">
              <button type="button" className="start-item-main" onClick={() => onConnect(host)}>
                <TerminalSquare size={16} strokeWidth={1.7} />
                <span>
                  <strong>{profileLabel(host)}</strong>
                  <em>{profileTarget(host)}</em>
                </span>
              </button>
              <button type="button" className="ghost-btn" onClick={() => onEdit(host)}>
                编辑
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
