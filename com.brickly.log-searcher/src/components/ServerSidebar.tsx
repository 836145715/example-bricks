import { Copy, PanelLeftClose, PanelLeftOpen, Plus, Server, Settings, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { ServerConfig } from '../types'

interface ServerSidebarProps {
  servers: ServerConfig[]
  activeServerId: string
  collapsed: boolean
  onToggleCollapsed: () => void
  onAdd: () => void
  onSelect: (server: ServerConfig) => void
  onEdit: (server: ServerConfig, event: MouseEvent) => void
  onClone: (server: ServerConfig, event: MouseEvent) => void
  onDelete: (serverId: string, event: MouseEvent) => void
}

export function ServerSidebar({
  servers,
  activeServerId,
  collapsed,
  onToggleCollapsed,
  onAdd,
  onSelect,
  onEdit,
  onClone,
  onDelete
}: ServerSidebarProps) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-topbar">
        <button
          className="sidebar-action-btn sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          type="button"
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      <div className="sidebar-title-section">
        <span className="sidebar-title">SSH 服务器 ({servers.length})</span>
        <button
          className="sidebar-action-btn"
          onClick={onAdd}
          title="添加连接配置"
          type="button"
        >
          <Plus size={14} />
        </button>
      </div>

      <nav className="server-list">
        {servers.map(server => (
          <button
            key={server.id}
            className={`server-item ${activeServerId === server.id ? 'active' : ''}`}
            onClick={() => onSelect(server)}
            title={server.name}
            type="button"
          >
            <div className="server-item-left">
              <Server size={14} />
              <span className="server-name" title={server.name}>{server.name}</span>
            </div>
            <div className="server-item-actions">
              <button
                className="server-item-btn"
                onClick={(event) => onEdit(server, event)}
                title="修改配置"
                type="button"
              >
                <Settings size={12} />
              </button>
              <button
                className="server-item-btn"
                onClick={(event) => onClone(server, event)}
                title="克隆配置"
                type="button"
              >
                <Copy size={12} />
              </button>
              <button
                className="server-item-btn"
                onClick={(event) => onDelete(server.id, event)}
                title="删除配置"
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </button>
        ))}
        {servers.length === 0 && (
          <div style={{ padding: '20px 10px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
            暂无连接配置，请点击右上角添加。
          </div>
        )}
      </nav>
    </aside>
  )
}
