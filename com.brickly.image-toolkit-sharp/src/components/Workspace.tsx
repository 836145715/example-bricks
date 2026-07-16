import { useRef } from 'react'
import { CircleNotch, Image as ImageIcon, X } from '@phosphor-icons/react'
import { isMultiAction } from '../config/tools'
import { formatBytes } from '../lib/format'
import type {
  ActionId,
  CropMode,
  CropRect,
  LocalFile,
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

function PaneShell({
  title,
  badge,
  children,
  accent,
}: {
  title: string
  badge?: string
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border ${
        accent
          ? 'border-[var(--ac-line)] bg-[var(--bg-sunken)]'
          : 'border-[var(--line)] bg-[var(--bg-sunken)]'
      }`}
    >
      <div
        className={`flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 ${
          accent
            ? 'border-[var(--ac-line)] bg-[var(--ac-soft)]'
            : 'border-[var(--line)] bg-[var(--bg-1)]'
        }`}
      >
        <span
          className={`text-[12px] font-semibold ${
            accent ? 'text-[var(--ac)]' : 'text-[var(--fg-muted)]'
          }`}
        >
          {title}
        </span>
        {badge ? (
          <span className="truncate font-mono text-[10.5px] text-[var(--fg-dim)]">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}

export function Workspace({
  action,
  files,
  onAddFiles,
  onRemoveFile,
  cropMode: _cropMode,
  cropRect,
  onCropChange,
  cropAspect,
  result,
  lastOutputPath,
  onToast,
  isRunning,
  progress,
  progressMessage,
  selectedResultIndex,
  onSelectResultIndex,
}: WorkspaceProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const cropContainerRef = useRef<HTMLDivElement>(null)
  const multi = isMultiAction(action)
  const empty = files.length === 0
  const isCropping = action === 'crop'

  const previewHit = firstPreviewItem(result, selectedResultIndex)
  const resultSrc = previewHit?.item.previewDataUrl || ''
  const inputSrc = files[0]?.previewUrl || ''
  const cropEnabled = isCropping && !empty && !multi && !isRunning

  const sizeHint = (() => {
    const it = previewHit?.item
    if (!it?.ok) return ''
    const parts: string[] = []
    if (it.inputSizeKb != null && it.sizeKb != null) {
      parts.push(`${it.inputSizeKb} → ${it.sizeKb} KB`)
    } else if (it.sizeKb != null) {
      parts.push(`${it.sizeKb} KB`)
    }
    if (it.format) parts.push(String(it.format).toUpperCase())
    if (it.width && it.height) parts.push(`${it.width}×${it.height}`)
    if (it.previewOnly || result?.summary?.previewOnly) parts.push('未落盘')
    return parts.join(' · ')
  })()

  const originalBadge = files[0]
    ? `${files[0].name} · ${formatBytes(files[0].size)}`
    : undefined

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-0)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0 truncate text-[12px] text-[var(--fg-dim)]">
          {empty
            ? '工作区 · 左原图 · 右结果'
            : multi
              ? `${files.length} 张 · 预览以第一张为准`
              : '左原图 · 右结果（调参自动更新）'}
        </div>
        {files.length > 0 ? <DropZone onFiles={onAddFiles} compact /> : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        {empty ? (
          <div className="h-full min-h-0">
            <DropZone onFiles={onAddFiles} />
          </div>
        ) : multi ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="scroll-y min-h-0 max-h-[40%] shrink-0">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
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
                    <div className="truncate px-1.5 py-1 text-[10.5px] text-[var(--fg-muted)]">
                      {f.name}
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
            <div className="flex min-h-0 flex-1 gap-2">
              <PaneShell title="结果" badge={sizeHint || undefined} accent>
                {resultSrc ? (
                  <div className="flex h-full items-center justify-center p-2">
                    <img
                      key={resultSrc}
                      src={resultSrc}
                      alt="结果"
                      className="max-h-full max-w-full object-contain"
                      draggable={false}
                    />
                  </div>
                ) : (
                  <EmptyResult isRunning={isRunning} message={progressMessage} progress={progress} />
                )}
              </PaneShell>
            </div>
          </div>
        ) : (
          /* Default dual pane: original | result */
          <div className="flex h-full min-h-0 gap-2">
            <PaneShell title="原图" badge={originalBadge}>
              <div
                ref={cropContainerRef}
                className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden p-2"
              >
                {inputSrc ? (
                  <>
                    <img
                      ref={imageRef}
                      src={inputSrc}
                      alt={files[0]?.name || '原图'}
                      className="pointer-events-none block h-auto w-auto max-h-full max-w-full object-contain select-none"
                      draggable={false}
                    />
                    <CropOverlay
                      imageRef={imageRef}
                      containerRef={cropContainerRef}
                      onChange={onCropChange}
                      enabled={cropEnabled}
                      aspectRatio={cropAspect}
                    />
                    {cropEnabled ? (
                      <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-[var(--radius-sm)] bg-black/55 px-2 py-1 text-[11px] text-white/90">
                        拖动框移动 · 四角缩放
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="absolute right-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-black/50 text-white/90 hover:bg-black/70"
                      onClick={() => onRemoveFile(files[0].id)}
                      aria-label="移除"
                    >
                      <X size={14} weight="bold" />
                    </button>
                  </>
                ) : null}
              </div>
            </PaneShell>

            <PaneShell title="结果" badge={sizeHint || undefined} accent>
              {resultSrc ? (
                <div className="flex h-full items-center justify-center p-2">
                  <img
                    key={resultSrc}
                    src={resultSrc}
                    alt="结果"
                    className="block h-auto w-auto max-h-full max-w-full object-contain select-none"
                    draggable={false}
                  />
                </div>
              ) : (
                <EmptyResult
                  isRunning={isRunning}
                  message={progressMessage}
                  progress={progress}
                />
              )}
            </PaneShell>
          </div>
        )}

        {isRunning && multi ? (
          <div className="pointer-events-none absolute bottom-4 right-4 z-20 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-2)]/95 px-3 py-2 shadow-lg">
            <div className="flex items-center gap-2 text-[12px] text-[var(--fg-muted)]">
              <CircleNotch size={14} className="animate-spin text-[var(--ac)]" />
              <span>
                {progressMessage || '处理中'} · {progress}%
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <ResultDrawer
        result={result}
        lastOutputPath={lastOutputPath}
        onToast={onToast}
        selectedIndex={selectedResultIndex}
        onSelectIndex={onSelectResultIndex}
      />
    </section>
  )
}

function EmptyResult({
  isRunning,
  message,
  progress,
}: {
  isRunning: boolean
  message: string
  progress: number
}) {
  if (isRunning) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <CircleNotch size={22} className="animate-spin text-[var(--ac)]" />
        <p className="text-[12.5px] text-[var(--fg-muted)]">
          {message || '预览生成中…'}
        </p>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-[var(--bg-3)]">
          <div
            className="h-full rounded-full bg-[var(--ac)] transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <ImageIcon size={28} className="text-[var(--fg-dim)]" weight="duotone" />
      <p className="text-[13px] font-medium text-[var(--fg-muted)]">结果将显示在这里</p>
      <p className="max-w-[220px] text-[11.5px] leading-relaxed text-[var(--fg-dim)]">
        调整左侧参数后会自动预览（不写磁盘）。满意后点「保存」写出文件。
      </p>
    </div>
  )
}
