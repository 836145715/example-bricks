import { Check, FolderOpen, Link2, Lock, MountainSnow, Plus, ShieldOff } from 'lucide-react'
import React from 'react'

import { formatBytes, formatShare, kindLabel } from '../format'
import type { NodeSummary, TreeNode } from '../types'

interface NodeListProps {
  node: TreeNode | undefined
  total: number
  selectedPath: string | null
  trayPaths: Set<string>
  emptyHint: string
  onSelect: (path: string) => void
  onDrill: (path: string) => void
  onAddToTray: (node: NodeSummary) => void
  onRemoveFromTray: (path: string) => void
  onReveal: (path: string) => void
}

/** 当前层列表：单击目录即下钻、单击文件选中；行尾按钮加入暂存箱。 */
export const NodeList: React.FC<NodeListProps> = ({
  node,
  total,
  selectedPath,
  trayPaths,
  emptyHint,
  onSelect,
  onDrill,
  onAddToTray,
  onRemoveFromTray,
  onReveal
}) => {
  const children = node?.children ?? []

  const rowClick = (child: NodeSummary) => {
    if (!child.path) return
    if (child.flags.kind === 'dir') {
      onDrill(child.path)
    } else {
      onSelect(child.path)
    }
  }

  return (
    <div className="node-list">
      <div className="node-list-head">
        <span className="col-name">名称</span>
        <span className="col-size">占用</span>
        <span className="col-logical">逻辑</span>
        <span className="col-share">占比</span>
        <span className="col-ops">操作</span>
      </div>
      <div className="node-list-body">
        {!node && <div className="list-empty">{emptyHint}</div>}
        {node && children.length === 0 && (
          <div className="list-empty">
            {node.flags.inaccessible ? '没有读取权限' : node.complete ? '空目录' : '扫描中…'}
          </div>
        )}
        {children.map((child) => {
          const badges = kindLabel(child.flags)
          const locked = child.flags.protected || child.flags.mount || child.flags.inaccessible
          const inTray = trayPaths.has(child.path)
          const sharePct = total > 0 ? Math.min(100, (child.allocatedBytes / total) * 100) : 0
          return (
            <div
              key={child.path || `other-${child.name}`}
              className={`node-row ${selectedPath && selectedPath === child.path ? 'selected' : ''} ${
                child.flags.kind === 'dir' ? 'drillable' : ''
              }`}
              onClick={() => rowClick(child)}
            >
              <span className="cell cell-name" title={child.path || '聚合的小项目'}>
                {child.flags.kind === 'dir' ? <FolderOpen size={13} className="icon-dir" /> : null}
                {child.flags.kind === 'link' ? <Link2 size={13} className="icon-link" /> : null}
                {child.flags.kind === 'other' ? <span className="icon-other">⋯</span> : null}
                <span className="row-name">{child.name}</span>
                {badges.map((badge) => (
                  <span key={badge} className={`badge badge-${badge}`}>
                    {badge === '锁定' && <Lock size={9} />}
                    {badge === '其他卷' && <MountainSnow size={9} />}
                    {badge === '无权限' && <ShieldOff size={9} />}
                    {badge}
                  </span>
                ))}
              </span>
              <span className="cell cell-size">{formatBytes(child.allocatedBytes)}</span>
              <span className="cell cell-logical">{formatBytes(child.logicalBytes)}</span>
              <span className="cell cell-share">
                <span className="share-track">
                  <span className="share-fill" style={{ width: `${sharePct}%` }} />
                </span>
                <em>{formatShare(child.allocatedBytes, total)}</em>
              </span>
              <span className="cell cell-ops">
                {child.flags.kind !== 'other' && (
                  <>
                    <button
                      type="button"
                      className={`row-btn ${inTray ? 'in-tray' : ''}`}
                      title={inTray ? '移出暂存箱' : locked ? '受保护，不能回收' : '加入暂存箱'}
                      disabled={locked}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (inTray && child.path) onRemoveFromTray(child.path)
                        else onAddToTray(child)
                      }}
                    >
                      {inTray ? <Check size={13} /> : <Plus size={13} />}
                      {inTray ? '已入箱' : '加入'}
                    </button>
                    <button
                      type="button"
                      className="row-btn"
                      title="在访达中显示"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (child.path) onReveal(child.path)
                      }}
                    >
                      <FolderOpen size={13} />
                    </button>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
