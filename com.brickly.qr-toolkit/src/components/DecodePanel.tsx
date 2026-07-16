import { Check, ClipboardText, ImageSquare, SpinnerGap } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/bridge'
import { DropZone } from './DropZone'

interface DecodePanelProps {
  /** 仅当前 Tab 激活时响应粘贴/拖放，避免与生成态冲突 */
  active: boolean
  busy: boolean
  previewUrl: string | null
  resultText: string | null
  errorMessage: string | null
  onFile: (file: File) => void
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
}

function pickImageFile(list: FileList | File[] | null | undefined): File | null {
  if (!list || list.length === 0) return null
  const files = Array.from(list)
  return (
    files.find(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name),
    ) || null
  )
}

function pickImageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null
  const fromFiles = pickImageFile(data.files)
  if (fromFiles) return fromFiles
  const items = data.items
  if (!items) return null
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const file = it.getAsFile()
      if (file) return file
    }
  }
  return null
}

export function DecodePanel({
  active,
  busy,
  previewUrl,
  resultText,
  errorMessage,
  onFile,
  onToast,
}: DecodePanelProps) {
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active

  const takeFile = useCallback(
    (file: File | null) => {
      if (!file || busy || !activeRef.current) return
      onFile(file)
    },
    [busy, onFile],
  )

  const handleCopy = async () => {
    if (!resultText) return
    const ok = await copyText(resultText)
    if (ok) {
      setCopied(true)
      onToast('ok', '已复制解析结果')
      window.setTimeout(() => setCopied(false), 1500)
    } else {
      onToast('error', '复制失败')
    }
  }

  const onDragEnter = (e: React.DragEvent) => {
    if (!active) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    if (e.dataTransfer.types.includes('Files')) setDragging(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    if (!active) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDragOver = (e: React.DragEvent) => {
    if (!active) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (e: React.DragEvent) => {
    if (!active) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    takeFile(pickImageFile(e.dataTransfer.files))
  }

  // 仅 active 时注册粘贴，避免生成页 Ctrl+V 被解析逻辑截获
  useEffect(() => {
    if (!active) {
      setDragging(false)
      dragDepth.current = 0
      return
    }

    const onPaste = (e: ClipboardEvent) => {
      if (!activeRef.current) return
      const img = pickImageFromClipboard(e.clipboardData)
      if (!img) return
      e.preventDefault()
      e.stopPropagation()
      takeFile(img)
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [active, takeFile])

  return (
    <div
      className="relative flex h-full min-h-0 flex-col gap-4 p-4"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {active && dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--ac)] bg-[var(--ac-soft)]/90">
          <div className="flex flex-col items-center gap-2 text-[var(--ac)]">
            <ImageSquare size={32} weight="duotone" />
            <p className="text-[13px] font-semibold">松开以解析新图片</p>
          </div>
        </div>
      )}

      {!previewUrl ? (
        <DropZone onFile={onFile} busy={busy || !active} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-[var(--fg-muted)]">源图预览</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--fg-dim)]">拖放 / Ctrl+V 可换图</span>
                <button
                  type="button"
                  disabled={busy || !active}
                  onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/png,image/jpeg,.png,.jpg,.jpeg'
                    input.onchange = () => {
                      const f = input.files?.[0]
                      if (f) onFile(f)
                    }
                    input.click()
                  }}
                  className="text-[11.5px] text-[var(--ac)] hover:underline disabled:opacity-50"
                >
                  选择文件
                </button>
              </div>
            </div>
            <div
              className={`relative flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--bg-sunken)] p-3 transition ${
                dragging && active ? 'border-[var(--ac)]' : 'border-[var(--line)]'
              }`}
            >
              <img
                src={previewUrl}
                alt="待解析"
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
              {busy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <SpinnerGap size={28} className="animate-spin text-[var(--ac)]" />
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <span className="text-[12px] font-medium text-[var(--fg-muted)]">解析结果</span>
            <div className="flex min-h-[200px] flex-1 flex-col rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-2)]">
              {errorMessage ? (
                <div className="flex flex-1 items-center justify-center p-4 text-center text-[13px] text-[var(--danger)]">
                  {errorMessage}
                </div>
              ) : resultText != null ? (
                <>
                  <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[12.5px] text-[var(--fg)]">
                    {resultText}
                  </pre>
                  <div className="flex border-t border-[var(--line)] p-2">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-3)] px-2.5 text-[12px] text-[var(--fg-muted)] transition hover:border-[var(--ac-line)] hover:text-[var(--fg)]"
                    >
                      {copied ? (
                        <Check size={14} className="text-[var(--ok)]" />
                      ) : (
                        <ClipboardText size={14} />
                      )}
                      {copied ? '已复制' : '复制文本'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-4 text-[12.5px] text-[var(--fg-dim)]">
                  {busy ? '正在解析…' : '等待解析'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
