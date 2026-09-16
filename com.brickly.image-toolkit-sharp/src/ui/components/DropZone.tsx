import { useCallback, useRef, useState } from 'react'
import { ImageSquare, Plus } from '@phosphor-icons/react'

interface DropZoneProps {
  onFiles: (files: FileList | File[]) => void
  compact?: boolean
}

export function DropZone({ onFiles, compact }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files)
    },
    [onFiles],
  )

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2.5 text-[12px] text-[var(--fg-muted)] transition hover:border-[var(--ac-line)] hover:text-[var(--fg)]"
        >
          <Plus size={14} weight="bold" />
          添加图片
        </button>
      </div>
    )
  }

  return (
    <div
      className={`flex h-full min-h-[280px] w-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed px-6 transition ${
        dragging
          ? 'border-[var(--ac)] bg-[var(--ac-soft)]'
          : 'border-[var(--line)] bg-[var(--bg-sunken)]'
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-2)] text-[var(--ac)]">
        <ImageSquare size={28} weight="duotone" />
      </div>
      <div className="text-center">
        <p className="text-[14px] font-semibold text-[var(--fg)]">拖放图片到此处</p>
        <p className="mt-1 text-[12px] text-[var(--fg-dim)]">
          支持 PNG、JPEG、WebP、AVIF、GIF
        </p>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--ac)] px-4 text-[13px] font-semibold text-[var(--ac-fg)] transition hover:brightness-110 active:scale-[0.98]"
      >
        <Plus size={15} weight="bold" />
        选择文件
      </button>
    </div>
  )
}
