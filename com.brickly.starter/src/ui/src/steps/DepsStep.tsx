import { useEffect, useState } from 'react'
import { getBrickDetail } from '../brickly'
import type { DevBrickDetail, DevBrickSummary, StarterDraft, ToolDependency } from '../types'

interface Props {
  draft: StarterDraft
  bricks: DevBrickSummary[]
  onChange: (patch: Partial<StarterDraft>) => void
}

function displayName(name: DevBrickSummary['name']): string {
  if (typeof name === 'string') return name
  return name['zh-CN'] ?? name.en ?? Object.values(name)[0] ?? ''
}

function defaultAlias(brickId: string): string {
  return brickId.split('.').pop()?.replace(/-/g, '_') ?? 'dep'
}

export function DepsStep({ draft, bricks, onChange }: Props) {
  const [detail, setDetail] = useState<Record<string, DevBrickDetail | null>>({})
  const deps = draft.toolDependencies ?? []
  const usable = bricks.filter((b) => b.valid)

  const isSelected = (b: DevBrickSummary) =>
    deps.some((d) => d.brickId === b.brickId && d.origin === b.origin && d.version === b.version)

  const toggle = (b: DevBrickSummary) => {
    if (isSelected(b)) {
      onChange({
        toolDependencies: deps.filter(
          (d) => !(d.brickId === b.brickId && d.origin === b.origin && d.version === b.version)
        )
      })
    } else {
      onChange({
        toolDependencies: [
          ...deps,
          { alias: defaultAlias(b.brickId), brickId: b.brickId, origin: b.origin, version: b.version }
        ]
      })
    }
  }

  const setAlias = (dep: ToolDependency, alias: string) => {
    onChange({
      toolDependencies: deps.map((d) => (d === dep ? { ...d, alias } : d))
    })
  }

  useEffect(() => {
    for (const dep of deps) {
      const key = `${dep.brickId}@${dep.version}`
      if (!(key in detail)) {
        void getBrickDetail({
          brickId: dep.brickId,
          origin: dep.origin as DevBrickSummary['origin'],
          version: dep.version
        }).then((d) => setDetail((prev) => ({ ...prev, [key]: d })))
      }
    }
  }, [deps, detail])

  return (
    <div className="step">
      <h2>依赖工具</h2>
      <p className="hint">勾选后会在 manifest.dependencies 里声明，新砖 runtime 可通过依赖调用其命令。</p>
      {usable.length === 0 && <p className="hint">开发目录中暂无可依赖的工具。</p>}
      <ul className="dep-list">
        {usable.map((b) => {
          const key = `${b.brickId}@${b.version}`
          const selected = isSelected(b)
          const dep = deps.find(
            (d) => d.brickId === b.brickId && d.origin === b.origin && d.version === b.version
          )
          const det = detail[key]
          return (
            <li key={key} className={`dep-item ${selected ? 'selected' : ''}`}>
              <label className="dep-head">
                <input type="checkbox" checked={selected} onChange={() => toggle(b)} />
                <strong>{displayName(b.name)}</strong>
                <code>{key}</code>
                <span className={`badge ${b.origin}`}>{b.origin}</span>
              </label>
              {selected && dep && (
                <div className="dep-body">
                  <label className="field inline">
                    <span>别名（dependencies key）</span>
                    <input value={dep.alias} onChange={(e) => setAlias(dep, e.target.value)} />
                  </label>
                  {det && Array.isArray(det.manifest.commands) && (
                    <p className="hint">
                      可调用命令：
                      {(det.manifest.commands as Array<{ id: string }>).map((c) => c.id).join(', ')}
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
