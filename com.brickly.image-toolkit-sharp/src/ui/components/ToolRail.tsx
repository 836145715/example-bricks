import {
  ArrowClockwise,
  ArrowsOut,
  Crop,
  Drop,
  FilePdf,
  FilmStrip,
  FlipHorizontal,
  FrameCorners,
  Image,
  ImagesSquare,
  MagicWand,
  SelectionInverse,
  TextT,
} from '@phosphor-icons/react'
import { MULTI_TOOLS, SINGLE_TOOLS } from '../config/tools'
import type { ActionId } from '../types'

const ICON_MAP: Record<
  ActionId,
  React.ComponentType<{
    size?: number
    weight?: 'regular' | 'bold' | 'duotone' | 'fill'
    className?: string
  }>
> = {
  compress: Drop,
  convert: Image,
  resize: ArrowsOut,
  watermark: TextT,
  roundedCorners: FrameCorners,
  padding: SelectionInverse,
  crop: Crop,
  rotate: ArrowClockwise,
  flip: FlipHorizontal,
  stripMeta: MagicWand,
  join: ImagesSquare,
  pdf: FilePdf,
  gif: FilmStrip,
}

interface ToolRailProps {
  activeAction: ActionId
  onSelect: (id: ActionId) => void
}

function Group({
  title,
  tools,
  activeAction,
  onSelect,
}: {
  title: string
  tools: typeof SINGLE_TOOLS
  activeAction: ActionId
  onSelect: (id: ActionId) => void
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-dim)]">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">
        {tools.map((tool) => {
          const Icon = ICON_MAP[tool.id]
          const active = tool.id === activeAction
          return (
            <button
              key={tool.id}
              type="button"
              title={tool.description}
              onClick={() => onSelect(tool.id)}
              className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12.5px] transition ${
                active
                  ? 'bg-[var(--ac-soft)] font-semibold text-[var(--ac)]'
                  : 'text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]'
              }`}
            >
              <Icon
                size={16}
                weight={active ? 'fill' : 'regular'}
                className="shrink-0"
              />
              <span className="truncate">{tool.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ToolRail({ activeAction, onSelect }: ToolRailProps) {
  return (
    <aside className="scroll-y flex h-full w-[148px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-1)] py-3 pl-2 pr-1.5">
      <Group
        title="单图"
        tools={SINGLE_TOOLS}
        activeAction={activeAction}
        onSelect={onSelect}
      />
      <Group
        title="多图"
        tools={MULTI_TOOLS}
        activeAction={activeAction}
        onSelect={onSelect}
      />
    </aside>
  )
}
