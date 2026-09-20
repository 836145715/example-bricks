import { Plus, Server, TerminalSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
    <section className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-10 py-14">
        <h1 className="text-2xl font-semibold tracking-tight">新连接</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">选择一个 Profile 打开终端，或先建一台主机。</p>

        <Button className="mt-6" onClick={onCreate}>
          <Plus />
          新建 Profile
        </Button>

        <div className="mt-10">
          <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            已保存的主机
          </div>
          {profiles.length === 0 ? (
            <div className="border-border grid place-items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
              <Server className="text-muted-foreground size-8" strokeWidth={1.5} />
              <p className="text-muted-foreground text-sm">还没有保存的主机</p>
              <Button variant="outline" size="sm" onClick={onCreate}>
                <Plus />
                新建 Profile
              </Button>
            </div>
          ) : (
            <ul className="grid gap-1">
              {profiles.map((host) => (
                <li
                  key={host.id}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5',
                    'hover:border-border hover:bg-accent/60 transition-colors'
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => onConnect(host)}
                  >
                    <span className="bg-primary-soft text-primary grid size-9 shrink-0 place-items-center rounded-md">
                      <TerminalSquare className="size-4" strokeWidth={1.7} />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-sm font-medium">{profileLabel(host)}</span>
                      <span className="text-muted-foreground truncate font-mono text-xs">
                        {profileTarget(host)}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => onEdit(host)}
                  >
                    编辑
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
