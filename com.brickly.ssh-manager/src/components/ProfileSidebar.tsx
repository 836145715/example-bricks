import clsx from 'clsx'
import { Pencil, Plus, Search, TerminalSquare } from 'lucide-react'
import { useMemo } from 'react'
import { profileLabel, profileTarget } from '../state/manager-state'
import type { Host } from '../types'

type GroupedProfiles = {
  name: string
  hosts: Host[]
}

export function ProfileSidebar({
  profiles,
  query,
  selectedProfileId,
  onQueryChange,
  onConnect,
  onEdit,
  onCreate
}: {
  profiles: Host[]
  query: string
  selectedProfileId: string | null
  onQueryChange: (value: string) => void
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onCreate: () => void
}) {
  const groups = useMemo(() => groupProfiles(profiles), [profiles])

  return (
    <div className="sidebar-pane">
      <div className="sidebar-toolbar">
        <label className="search-box">
          <Search size={13} strokeWidth={2} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索主机"
          />
        </label>
        <button type="button" className="icon-btn" title="新建主机" onClick={onCreate}>
          <Plus size={14} />
        </button>
      </div>
      <div className="host-tree">
        {groups.length === 0 ? (
          <div className="empty-block">
            <p>还没有主机配置</p>
            <button type="button" className="text-btn" onClick={onCreate}>
              新建第一个
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.name} className="host-group">
              <header className="host-group-title">
                <span>{group.name}</span>
                <span>{group.hosts.length}</span>
              </header>
              {group.hosts.map((host) => (
                <div
                  key={host.id}
                  className={clsx('profile-row', selectedProfileId === host.id && 'is-active')}
                >
                  <button
                    type="button"
                    className="profile-main"
                    onClick={() => onConnect(host)}
                    onDoubleClick={() => onConnect(host)}
                  >
                    <TerminalSquare size={13} strokeWidth={1.8} />
                    <span>
                      <span className="host-row-name">{profileLabel(host)}</span>
                      <span className="host-row-meta">{profileTarget(host)}</span>
                    </span>
                  </button>
                  <button type="button" className="icon-btn ghost" title="编辑" onClick={() => onEdit(host)}>
                    <Pencil size={12} />
                  </button>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function groupProfiles(hosts: Host[]): GroupedProfiles[] {
  const map = new Map<string, Host[]>()
  for (const host of hosts) {
    const name = host.group?.trim() || '未分组'
    const list = map.get(name) ?? []
    list.push(host)
    map.set(name, list)
  }
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([name, items]) => ({
      name,
      hosts: items.slice().sort((a, b) => profileLabel(a).localeCompare(profileLabel(b), 'zh-CN'))
    }))
}
