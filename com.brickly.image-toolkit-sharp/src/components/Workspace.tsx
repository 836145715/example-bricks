import { useRef } from 'react'
import { X } from '@phosphor-icons/react'
import { isMultiAction } from '../config/tools'
import { formatBytes } from '../lib/format'
import type { ActionId, CropMode, CropRect, LocalFile } from '../types'
import { CropOverlay } from './CropOverlay'
import { DropZone } from './DropZone'
import { ResultDrawer } from './ResultDrawer'
import type { ProcessImageResult } from '../types'

interface WorkspaceProps {
  action: ActionId
  files: LocalFile[]
  onAddFiles: (files: FileList | File[]) => void
  onRemoveFile: (id: string) => void
  cropMode: CropMode
  cropRect: CropRect
  onCropChange: (rect: CropRect) => void
  cropAspect: number | null
  result: ProcessImageResult | null
  lastOutputPath: string | null
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void
  isRunning: boolean
  progress: number
  progressMessage: string
}

export function Workspace({
  action,
  files,
  onAddFiles,
  onRemoveFile,
  cropMode,
  cropRect,
  onCropChange,
  cropAspect,
  result,
  lastOutputPath,
  onToast,
  isRunning,
  progress,
  progressMessage,
}: WorkspaceProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const multi = isMultiAction(action)
  const showDrop = files.length === 0
  const showGrid = !showDrop && multi
  const showPreview = !showDrop && !multi
  const cropEnabled = action === 'crop' && cropMode === 'drag' && showPreview

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-0)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0 truncate text-[12px] text-[var(--fg-dim)]">
          {files.length === 0
            ? '工作区'
            : multi
              ? `${files.length} 张待处理`
              : `主图 · ${files[0]?.name ?? ''}`}
        </div>
        {files.length > 0 ? <DropZone onFiles={onAddFiles} compact /> : null}
      </div>

      {/* flex-1 + min-h-0: pin preview inside remaining height so ProcessBar stays visible */}
      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        {showDrop ? (
          <div className="h-full min-h-0">
            <DropZone onFiles={onAddFiles} />
          </div>
        ) : null}

        {showGrid ? (
          <div className="scroll-y h-full min-h-0">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-2)]"
                >
                  <div className="aspect-square overflow-hidden bg-[var(--bg-sunken)]">
                    <img
                      src={f.previewUrl}
                      alt={f.name}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="truncate text-[11.5px] font-medium text-[var(--fg)]">
                      {f.name}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--fg-dim)]">
                      {formatBytes(f.size)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
                    onClick={() => onRemoveFile(f.id)}
                    aria-label="移除"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showPreview ? (
          <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-sunken)] p-2">
            {/*
              Parent chain uses min-h-0 + flex-1 so this box has a real height.
              max-h-full / max-w-full force the image to scale down inside it
              without growing the layout (keeps ProcessBar visible).
            */}
            <img
              ref={imageRef}
              src={files[0].previewUrl}
              alt={files[0].name}
              className="block h-auto w-auto max-h-full max-w-full object-contain select-none"
              draggable={false}
            />
            <CropOverlay
              imageRef={imageRef}
              rect={cropRect}
              onChange={onCropChange}
              enabled={cropEnabled}
              aspectRatio={cropAspect}
            />
            {files.length > 1 ? (
              <div className="absolute bottom-2 left-2 z-10 rounded-[var(--radius-sm)] bg-black/55 px-2 py-1 text-[11px] text-white/90">
                另有 {files.length - 1} 张将按相同参数批量处理
              </div>
            ) : null}
            <button
              type="button"
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-black/50 text-white/90 hover:bg-black/70"
              onClick={() => onRemoveFile(files[0].id)}
              aria-label="移除当前图"
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        ) : null}

        {isRunning ? (
          <div className="absolute inset-3 z-20 flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--bg-0)]/70 backdrop-blur-[2px]">
            <div className="w-[min(320px,90%)] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-2)] px-4 py-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between text-[12px]">
                <span className="text-[var(--fg-muted)]">
                  {progressMessage || '处理中...'}
                </span>
                <span className="font-mono tabular-nums text-[var(--fg)]">{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-3)]">
                <div
                  className="h-full rounded-full bg-[var(--ac)] transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <ResultDrawer
        result={result}
        lastOutputPath={lastOutputPath}
        onToast={onToast}
      />
    </section>
  )
}
