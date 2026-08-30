import { X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import type { ClipItem } from '../types'

interface ImagePreviewDialogProps {
  item: ClipItem
  onClose: () => void
}

/**
 * 高清图片预览与手势交互弹窗：
 * 支持鼠标滚轮比例缩放、鼠标拖拽平移、双击重置/放大、实时尺寸与放缩比例 HUD 提示。
 */
export const ImagePreviewDialog: React.FC<ImagePreviewDialogProps> = ({ item, onClose }) => {
  const imagePath = item.imagePath || item.imageOriginalPath || item.path
  if (!imagePath) return null

  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      let factor = -e.deltaY * 0.0015
      if (e.ctrlKey) {
        factor = -e.deltaY * 0.015
      }

      setScale((s) => {
        const next = s + s * factor
        return Math.max(0.15, Math.min(next, 10))
      })
    }

    overlay.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => {
      overlay.removeEventListener('wheel', handleWheelNative)
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    e.preventDefault()
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }

  const handleMouseUp = () => setIsDragging(false)

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (scale > 1.05 || position.x !== 0 || position.y !== 0) {
      setScale(1)
      setPosition({ x: 0, y: 0 })
    } else {
      setScale(2)
    }
  }

  const fileName = item.title || imagePath.split(/[\\/]/).pop() || '图片预览'

  return (
    <div ref={overlayRef} className="preview-overlay" onClick={onClose}>
      {/* 极简右上角关闭按钮 */}
      <button
        type="button"
        className="preview-close-btn"
        onClick={onClose}
        title="关闭预览 (Esc)"
      >
        <X size={15} />
      </button>

      {/* 浮动图像中心 */}
      <img
        className="preview-image"
        src={fileUrl(imagePath)}
        alt={fileName}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onClick={(event) => event.stopPropagation()}
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
          transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        draggable={false}
      />

      {/* 底部浮动信息 HUD 标签 */}
      <div className="preview-hud select-none">
        <span className="truncate max-w-[160px] font-medium" title={fileName}>
          {fileName}
        </span>
        {item.size && (
          <>
            <span className="hud-sep">•</span>
            <span>{formatSize(item.size)}</span>
          </>
        )}
        <span className="hud-sep">•</span>
        <span>{item.width && item.height ? `${item.width}×${item.height}` : '未知尺寸'}</span>
        <span className="hud-sep">•</span>
        <span className="text-[var(--ac)] font-mono font-bold">{Math.round(scale * 100)}%</span>
      </div>
    </div>
  )
}

/* ───────────────────────── 辅助工具函数 ───────────────────────── */

function fileUrl(p?: string): string {
  if (!p) return ''
  return 'file:///' + p.replaceAll('\\', '/')
}

function formatSize(bytes = 0): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
