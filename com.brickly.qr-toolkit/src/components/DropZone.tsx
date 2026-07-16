import { ImageSquare, Plus } from '@phosphor-icons/react'
import { useCallback, useRef, useState } from 'react'

interface DropZoneProps {
  onFile: (file: File) => void
  busy?: boolean
}

export function DropZone({ onFile, busy }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const takeFirstImage = useCallback(
    (list: FileList | File[] | null | undefined) => {
      if (!list || list.length === 0) return
      const files = Array.from(list)
      const img = files.find(
        (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name),
      )
      if (img) onFile(img)
    },
    [onFile],
  )

  return (
    <div
      className={`flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed px-6 transition ${
        dragging
          ? 'border-[var(--ac)] bg-[var(--ac-soft)]'
          : 'border-[var(--line)] bg-[var(--bg-sunken)]'
      } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        takeFirstImage(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          takeFirstImage(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-2)] text-[var(--ac)]">
        <ImageSquare size={26} weight="duotone" />
      </div>
      <div className="text-center">
        <p className="text-[14px] font-semibold text-[var(--fg)]">拖放图片到此处</p>
        <p className="mt-1 text-[12px] text-[var(--fg-dim)]">
          支持 PNG、JPEG；也可 Ctrl+V 粘贴剪贴板图片
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--ac)] px-4 text-[13px] font-semibold text-[var(--ac-fg)] transition hover:brightness-110 active:scale-[0.98]"
      >
        <Plus size={15} weight="bold" />
        选择文件
      </button>
    </div>
  )
}
