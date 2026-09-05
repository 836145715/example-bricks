/**
 * NodeStore：扫描树在页面侧的镜像。
 * scan 的 node 事件与 peek 结果都先写进 store，经 requestAnimationFrame 合并后
 * 统一 bump version 触发订阅重渲染，禁止每个事件直接 setState 重算旭日图。
 */

import type { NodeSummary, TreeNode } from './types'

export class NodeStore {
  private nodes = new Map<string, TreeNode>()
  private listeners = new Set<() => void>()
  private version = 0
  private rafId = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  /** scan 的 node 事件：更新摘要但保留已知的孩子们。 */
  applySummary(summary: NodeSummary): void {
    const existing = this.nodes.get(summary.path)
    const merged: TreeNode = {
      ...summary,
      children: existing?.children ?? []
    }
    this.nodes.set(summary.path, merged)
    this.scheduleFlush()
  }

  /** peek 结果：完整替换该路径的节点（含孩子）。 */
  applyPeek(node: TreeNode): void {
    this.nodes.set(node.path, { ...node, children: node.children ?? [] })
    this.scheduleFlush()
  }

  /** trash 成功后清除该路径的镜像（大小由重新 peek 修正）。 */
  remove(path: string): void {
    for (const key of this.nodes.keys()) {
      if (key === path || key.startsWith(path + '/')) {
        this.nodes.delete(key)
      }
    }
    this.scheduleFlush()
  }

  get(path: string): TreeNode | undefined {
    return this.nodes.get(path)
  }

  /** 统计不可访问目录（完全磁盘访问提示）。 */
  inaccessibleCount(): number {
    let count = 0
    for (const node of this.nodes.values()) {
      if (node.flags.inaccessible) count++
    }
    return count
  }

  reset(): void {
    this.nodes.clear()
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.rafId || this.listeners.size === 0) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0
      this.version++
      for (const listener of this.listeners) {
        listener()
      }
    })
  }
}
