import { ChevronRight, FlaskConical, LockKeyhole, Play } from 'lucide-react'
import type { ScenarioDefinition, TestGroup, TestResult, TestStatus } from '../types'
import { getGroupIntro } from '../scenario-docs'

const GROUP_ORDER: TestGroup[] = ['create', 'read', 'cross-language', 'lifecycle', 'stress']

const STATUS_DOT: Partial<Record<TestStatus, string>> = {
  passed: 'passed',
  failed: 'failed',
  running: 'running',
  skipped: 'skipped',
  cancelled: 'cancelled',
  'waiting-restart': 'waiting',
  pending: 'pending'
}

interface ScenarioNavProps {
  scenarios: ScenarioDefinition[]
  focusId?: string
  lastById: Map<string, TestResult>
  busy: boolean
  onFocus(id: string): void
  onRunOne(id: string): void
}

export function ScenarioNav({ scenarios, focusId, lastById, busy, onFocus, onRunOne }: ScenarioNavProps) {
  return (
    <aside className="nav-panel">
      <div className="panel-heading">
        <div>
          <strong>场景列表</strong>
          <span>点选说明 · 运行看过/不过</span>
        </div>
      </div>
      <div className="nav-scroll">
        {GROUP_ORDER.map((group) => {
          const items = scenarios.filter((s) => s.group === group)
          if (items.length === 0) return null
          const intro = getGroupIntro(group)
          return (
            <section className="nav-group" key={group}>
              <header className="nav-group-head">
                <div>
                  <b>{intro.title}</b>
                  <p>{intro.summary}</p>
                </div>
                <small>{items.length}</small>
              </header>
              <ul className="nav-list">
                {items.map((item) => {
                  const last = lastById.get(item.id)
                  const status = last?.status
                  const active = focusId === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`nav-item${active ? ' active' : ''}${status ? ` is-${STATUS_DOT[status] ?? 'pending'}` : ''}`}
                        onClick={() => onFocus(item.id)}
                      >
                        <i className={`status-dot ${STATUS_DOT[status ?? 'pending'] ?? 'pending'}`} />
                        <span className="nav-item-copy">
                          <b>{item.title}</b>
                          <code>{item.id}</code>
                        </span>
                        <span className="nav-item-meta">
                          {item.mode === 'stress' && <FlaskConical aria-label="压力" />}
                          {item.exclusive && <LockKeyhole aria-label="独占" />}
                          <ChevronRight />
                        </span>
                      </button>
                      {active && (
                        <button
                          type="button"
                          className="nav-run-one"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            onRunOne(item.id)
                          }}
                        >
                          <Play /> 运行此场景
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </aside>
  )
}
