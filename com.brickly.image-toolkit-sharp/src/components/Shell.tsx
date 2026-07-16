import { Folder, ImageSquare } from '@phosphor-icons/react'
import { pickDirectory } from '../lib/bridge'
import type { CommonOptions, OutputStrategy } from '../types'

interface ShellProps {
  fileCount: number
  output: OutputStrategy
  onOutputChange: (next: OutputStrategy) => void
  common: CommonOptions
  onCommonChange: (next: CommonOptions) => void
  children: React.ReactNode
}

export function Shell({
  fileCount,
  output,
  onOutputChange,
  common,
  onCommonChange,
  children,
}: ShellProps) {
  return (
    <div className="flex h-full flex-col bg-[var(--bg-0)]">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-1)]/90 px-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--ac-soft)] text-[var(--ac)]">
            <ImageSquare size={18} weight="duotone" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-tight text-[var(--fg)]">
              万能图片工具箱
            </div>
            <div className="text-[11px] text-[var(--fg-dim)]">
              {fileCount === 0 ? '未选择文件' : `${fileCount} 个文件`}
            </div>
          </div>
        </div>

        <div className="mx-1 h-6 w-px bg-[var(--line)]" />

        {/* Output strategy */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-[11px] font-medium text-[var(--fg-dim)]">
            输出
          </span>
          <div className="flex rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-sunken)] p-0.5">
            {(
              [
                { id: 'sidecar' as const, label: '同目录旁路' },
                { id: 'dir' as const, label: '指定目录' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOutputChange({ ...output, mode: m.id })}
                className={`rounded-[6px] px-2 py-1 text-[11.5px] font-medium transition ${
                  output.mode === m.id
                    ? 'bg-[var(--bg-2)] text-[var(--ac)]'
                    : 'text-[var(--fg-dim)] hover:text-[var(--fg-muted)]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {output.mode === 'dir' ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <input
                type="text"
                className="h-7 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-sunken)] px-2 font-mono text-[11px] text-[var(--fg-muted)] outline-none focus:border-[var(--ac-line)]"
                placeholder="输出目录绝对路径"
                value={output.dir || ''}
                onChange={(e) => onOutputChange({ ...output, dir: e.target.value })}
              />
              <button
                type="button"
                title="选择目录"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--fg-muted)] hover:border-[var(--ac-line)] hover:text-[var(--fg)]"
                onClick={async () => {
                  const dir = await pickDirectory()
                  if (dir) onOutputChange({ ...output, mode: 'dir', dir })
                }}
              >
                <Folder size={14} />
              </button>
            </div>
          ) : null}

          <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] text-[var(--fg-dim)]">
            <input
              type="checkbox"
              className="accent-[var(--ac)]"
              checked={!!output.overwrite}
              onChange={(e) =>
                onOutputChange({ ...output, overwrite: e.target.checked })
              }
            />
            覆盖
          </label>
        </div>

        <div className="mx-1 h-6 w-px bg-[var(--line)]" />

        {/* Common options */}
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
            <input
              type="checkbox"
              className="accent-[var(--ac)]"
              checked={common.autoOrient}
              onChange={(e) =>
                onCommonChange({ ...common, autoOrient: e.target.checked })
              }
            />
            自动方向
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[var(--fg-muted)]">
            <input
              type="checkbox"
              className="accent-[var(--ac)]"
              checked={common.stripMetadata}
              onChange={(e) =>
                onCommonChange({ ...common, stripMetadata: e.target.checked })
              }
            />
            去元数据
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  )
}
