import { ChevronDown, LockKeyhole } from 'lucide-react'
import type { ScenarioDefinition, TestGroup } from '../types'

const GROUP_LABELS: Record<TestGroup, string> = {
  create: '创建与写入',
  read: '读取与落盘',
  'cross-language': '跨语言',
  lifecycle: '生命周期',
  stress: '边界与压力'
}

interface ScenarioTreeProps {
  scenarios: ScenarioDefinition[]
  selected: Set<string>
  disabled: boolean
  onChange(next: Set<string>): void
}

export function ScenarioTree({ scenarios, selected, disabled, onChange }: ScenarioTreeProps) {
  const groups = Object.entries(GROUP_LABELS) as [TestGroup, string][]
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(next)
  }
  const toggleGroup = (items: ScenarioDefinition[]) => {
    const next = new Set(selected)
    const allSelected = items.every((item) => next.has(item.id))
    for (const item of items) allSelected ? next.delete(item.id) : next.add(item.id)
    onChange(next)
  }

  return <aside className="scenario-panel">
    <div className="panel-heading"><div><strong>测试场景</strong><span>{scenarios.length} 项</span></div></div>
    <div className="scenario-scroll">
      {groups.map(([group, label]) => {
        const items = scenarios.filter((item) => item.group === group)
        if (items.length === 0) return null
        return <section className="scenario-group" key={group}>
          <button className="group-heading" onClick={() => toggleGroup(items)} disabled={disabled}>
            <ChevronDown /><span>{label}</span><small>{items.filter((item) => selected.has(item.id)).length}/{items.length}</small>
          </button>
          {items.map((item) => <label className="scenario-item" key={item.id} title={item.id}>
            <input type="checkbox" checked={selected.has(item.id)} disabled={disabled} onChange={() => toggle(item.id)} />
            <span className="checkmark" />
            <span className="scenario-copy"><b>{item.title}</b><code>{item.id}</code></span>
            {item.exclusive && <LockKeyhole aria-label="独占" />}
          </label>)}
        </section>
      })}
    </div>
  </aside>
}

export { GROUP_LABELS }
