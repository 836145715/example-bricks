import { useRef } from 'react'
import { CircleNotch, FilePdf, Image as ImageIcon, X } from '@phosphor-icons/react'
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
          <span className="min-w-0 truncate font-mono text-[10.5px] text-[var(--fg-dim)]">
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
  const isPdf = action === 'pdf'

  const previewHit = firstPreviewItem(result, selectedResultIndex)
  const resultSrc = previewHit?.item.previewDataUrl || ''
  const inputSrc = files[0]?.previewUrl || ''

  // Keep crop overlay mounted during auto-preview (isRunning) so the box does not reset
  const cropEnabled = isCropping && !empty && !multi

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

  const savedPath =
    lastOutputPath ||
    result?.items.find((i) => i.ok && i.outputPath)?.outputPath ||
    ''

  const originalBadge = files[0]
    ? `${files[0].name} · ${formatBytes(files[0].size)}`
    : undefined

  const headerHint = empty
    ? '工作区 · 左原图 · 右结果'
    : isPdf
      ? `${files.length} 张 · PDF 无预览，点保存生成文件`
      : multi
        ? `${files.length} 张 · 左选图 · 右结果`
        : '左原图 · 右结果（调参自动更新）'

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-0)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="min-w-0 truncate text-[12px] text-[var(--fg-dim)]">
          {headerHint}
        </div>
        {files.length > 0 ? <DropZone onFiles={onAddFiles} compact /> : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        {empty ? (
          <div className="h-full min-h-0">
            <DropZone onFiles={onAddFiles} />
          </div>
        ) : (
          <div className="flex h-full min-h-0 gap-2">
            {/* Left: original / multi thumbs */}
            <PaneShell
              title={multi ? `原图 (${files.length})` : '原图'}
              badge={multi ? undefined : originalBadge}
            >
              {multi ? (
                <div className="scroll-y h-full p-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
                    {files.map((f, i) => (
                      <div
                        key={f.id}
                        className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-2)]"
                      >
                        <div className="aspect-[4/3] overflow-hidden bg-[var(--bg-0)]">
                          <img
                            src={f.previewUrl}
                            alt={f.name}
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        </div>
                        <div className="flex items-center gap-1 px-1.5 py-1">
                          <span className="shrink-0 rounded bg-[var(--bg-3)] px-1 font-mono text-[10px] text-[var(--fg-dim)]">
                            {i + 1}
                          </span>
                          <span className="min-w-0 truncate text-[10.5px] text-[var(--fg-muted)]">
                            {f.name}
                          </span>
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
              ) : (
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
              )}
            </PaneShell>

            {/* Right: result (or PDF no-preview) */}
            <PaneShell
              title={isPdf ? '输出' : '结果'}
              badge={isPdf ? undefined : sizeHint || undefined}
              accent
            >
              {isPdf ? (
                <PdfResultPanel
                  isRunning={isRunning}
                  progress={progress}
                  progressMessage={progressMessage}
                  savedPath={savedPath}
                  fileCount={files.length}
                />
              ) : resultSrc ? (
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

function PdfResultPanel({
  isRunning,
  progress,
  progressMessage,
  savedPath,
  fileCount,
}: {
  isRunning: boolean
  progress: number
  progressMessage: string
  savedPath: string
  fileCount: number
}) {
  if (isRunning) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <CircleNotch size={22} className="animate-spin text-[var(--ac)]" />
        <p className="text-[12.5px] text-[var(--fg-muted)]">
          {progressMessage || '正在生成 PDF…'}
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
  if (savedPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <FilePdf size={36} className="text-[var(--ac)]" weight="duotone" />
        <p className="text-[13px] font-medium text-[var(--fg-muted)]">PDF 已生成</p>
        <p className="max-w-[260px] break-all font-mono text-[11px] text-[var(--fg-dim)]">
          {savedPath}
        </p>
        <p className="text-[11.5px] text-[var(--fg-dim)]">可点底部「打开目录」查看</p>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <FilePdf size={32} className="text-[var(--fg-dim)]" weight="duotone" />
      <p className="text-[13px] font-medium text-[var(--fg-muted)]">PDF 不提供预览</p>
      <p className="max-w-[240px] text-[11.5px] leading-relaxed text-[var(--fg-dim)]">
        已选 {fileCount} 张图。直接点「保存」生成多页 PDF 文件。
      </p>
    </div>
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
        调整参数后会自动预览（不写磁盘）。满意后点「保存」写出文件。
      </p>
    </div>
  )
}
