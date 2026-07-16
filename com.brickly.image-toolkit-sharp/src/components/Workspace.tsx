import { useRef } from 'react'
import { Eye, Image as ImageIcon, X } from '@phosphor-icons/react'
import { isMultiAction } from '../config/tools'
import { formatBytes } from '../lib/format'
import type {
  ActionId,
  CropMode,
  CropRect,
  LocalFile,
  PreviewMode,
  ProcessImageResult,
  ProcessItem,
} from '../types'
import { CropOverlay } from './CropOverlay'
import { DropZone } from './DropZone'
import { ResultDrawer } from './ResultDrawer'

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
  previewMode: PreviewMode
  onPreviewModeChange: (mode: PreviewMode) => void
  selectedResultIndex: number
  onSelectResultIndex: (index: number) => void
}

function firstPreviewItem(
  result: ProcessImageResult | null,
  preferredIndex: number,
): { item: ProcessItem; index: number } | null {
  if (!result?.items?.length) return null
  const preferred = result.items[preferredIndex]
  if (preferred?.ok && preferred.previewDataUrl) {
    return { item: preferred, index: preferredIndex }
  }
  const idx = result.items.findIndex((i) => i.ok && i.previewDataUrl)
  if (idx < 0) return null
  return { item: result.items[idx], index: idx }
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
  previewMode,
  onPreviewModeChange,
  selectedResultIndex,
  onSelectResultIndex,
}: WorkspaceProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const multi = isMultiAction(action)
  const showDrop = files.length === 0
  const showGrid = !showDrop && multi
  const showPreview = !showDrop && !multi

  const previewHit = firstPreviewItem(result, selectedResultIndex)
  const hasResultPreview = !!previewHit?.item.previewDataUrl
  const showResultImage =
    previewMode === 'result' && hasResultPreview && !isRunning

  // Crop only on original input while viewing input
  const cropEnabled =
    action === 'crop' &&
    cropMode === 'drag' &&
    showPreview &&
    previewMode === 'input' &&
    !showResultImage

  const displaySrc = showResultImage
    ? previewHit!.item.previewDataUrl!
    : showPreview
      ? files[0]?.previewUrl
      : ''

  const statusLabel = showDrop
    ? '工作区'
    : showResultImage
      ? `${previewHit?.item.previewOnly || result?.summary?.previewOnly ? '内存预览' : '结果预览'} · ${previewHit?.item.format || 'image'}${
          previewHit?.item.width && previewHit?.item.height
            ? ` · ${previewHit.item.width}×${previewHit.item.height}`
            : ''
        }${previewHit?.item.previewOnly || result?.summary?.previewOnly ? ' · 未落盘' : ''}`
      : multi
        ? `${files.length} 张待处理`
        : `主图 · ${files[0]?.name ?? ''}`

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-0)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0 truncate text-[12px] text-[var(--fg-dim)]">
          {statusLabel}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasResultPreview ? (
            <div className="flex rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-sunken)] p-0.5">
              <button
                type="button"
                onClick={() => onPreviewModeChange('input')}
                className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11.5px] font-medium transition ${
                  previewMode === 'input'
                    ? 'bg-[var(--bg-2)] text-[var(--ac)]'
                    : 'text-[var(--fg-dim)] hover:text-[var(--fg-muted)]'
                }`}
              >
                <ImageIcon size={12} />
                原图
              </button>
              <button
                type="button"
                onClick={() => onPreviewModeChange('result')}
                className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11.5px] font-medium transition ${
                  previewMode === 'result'
                    ? 'bg-[var(--bg-2)] text-[var(--ac)]'
                    : 'text-[var(--fg-dim)] hover:text-[var(--fg-muted)]'
                }`}
              >
                <Eye size={12} />
                结果
              </button>
            </div>
          ) : null}
          {files.length > 0 ? <DropZone onFiles={onAddFiles} compact /> : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        {showDrop ? (
          <div className="h-full min-h-0">
            <DropZone onFiles={onAddFiles} />
          </div>
        ) : null}

        {showGrid && !showResultImage ? (
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

        {(showPreview || showResultImage) && displaySrc ? (
          <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-sunken)] p-2">
            <img
              ref={imageRef}
              src={displaySrc}
              alt={showResultImage ? '处理结果' : files[0]?.name || 'preview'}
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
            {showResultImage ? (
              <div className="absolute left-2 top-2 z-10 rounded-[var(--radius-sm)] bg-[var(--ac)]/90 px-2 py-1 text-[11px] font-semibold text-[var(--ac-fg)]">
                {previewHit?.item.previewOnly || result?.summary?.previewOnly
                  ? '内存预览'
                  : '处理结果'}
                {previewHit?.item.sizeKb != null
                  ? ` · ${previewHit.item.sizeKb} KB`
                  : ''}
              </div>
            ) : null}
            {files.length > 1 && !showResultImage ? (
              <div className="absolute bottom-2 left-2 z-10 rounded-[var(--radius-sm)] bg-black/55 px-2 py-1 text-[11px] text-white/90">
                另有 {files.length - 1} 张将按相同参数批量处理
              </div>
            ) : null}
            {!showResultImage && files[0] ? (
              <button
                type="button"
                className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-black/50 text-white/90 hover:bg-black/70"
                onClick={() => onRemoveFile(files[0].id)}
                aria-label="移除当前图"
              >
                <X size={14} weight="bold" />
              </button>
            ) : null}
          </div>
        ) : null}

        {showGrid && showResultImage ? (
          <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-sunken)] p-2">
            <img
              src={previewHit!.item.previewDataUrl!}
              alt="处理结果"
              className="block h-auto w-auto max-h-full max-w-full object-contain select-none"
              draggable={false}
            />
            <div className="absolute left-2 top-2 z-10 rounded-[var(--radius-sm)] bg-[var(--ac)]/90 px-2 py-1 text-[11px] font-semibold text-[var(--ac-fg)]">
              处理结果
              {previewHit?.item.sizeKb != null
                ? ` · ${previewHit.item.sizeKb} KB`
                : ''}
            </div>
          </div>
        ) : null}

        {isRunning ? (
          <div className="absolute inset-3 z-20 flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--bg-0)]/70 backdrop-blur-[2px]">
            <div className="w-[min(320px,90%)] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-2)] px-4 py-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between text-[12px]">
                <span className="text-[var(--fg-muted)]">
                  {progressMessage || '处理中...'}
                </span>
                <span className="font-mono tabular-nums text-[var(--fg)]">
                  {progress}%
                </span>
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
        selectedIndex={selectedResultIndex}
        onSelectIndex={(idx) => {
          onSelectResultIndex(idx)
          if (result?.items[idx]?.ok && result.items[idx].previewDataUrl) {
            onPreviewModeChange('result')
          }
        }}
      />
    </section>
  )
}
