import clsx from 'clsx'
import {
  Star,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
  Folder,
  File
} from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { getFileIcon } from '../brickly'
import type { ClipItem } from '../types'

interface ClipRowProps {
  item: ClipItem
  index: number
  active: boolean
  onSelect: () => void
  onCopy: () => void
  onFavorite: () => void
  onRemove: () => void
  onPreviewImage: () => void
}

/** 相对时间转换器 */
const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

export const ClipRow: React.FC<ClipRowProps> = ({
  item,
  index,
  active,
  onSelect,
  onCopy,
  onFavorite,
  onRemove,
  onPreviewImage
}) => {
  const [expanded, setExpanded] = useState(false)
  const [fileIconUrl, setFileIconUrl] = useState<string | null>(null)
  const [iconsMap, setIconsMap] = useState<Record<string, string>>({})

  const imagePath = item.imagePath || item.imageOriginalPath || item.path
  const filePaths = useMemo(
    () => (item.type === 'file' ? normalizedFilePaths(item) : []),
    [item]
  )

  const body = item.text || item.preview || item.path || ''
  const canExpand =
    item.type === 'file'
      ? filePaths.length > 3
      : item.type !== 'image' &&
        ((item.text?.split(/\r?\n/).length ?? 0) > 2 ||
          (item.text?.length ?? 0) > 180)

  // 异步获取本地文件类型真实图标
  useEffect(() => {
    if (item.type !== 'file') return

    let alive = true
    if (filePaths.length === 1 && filePaths[0]) {
      getFileIcon(filePaths[0])
        .then((url: string) => {
          if (alive && url) setFileIconUrl(url)
        })
        .catch((err: unknown) => console.warn('[ClipRow] getFileIcon err', err))
    } else if (filePaths.length > 1) {
      filePaths.forEach((path) => {
        getFileIcon(path)
          .then((url: string) => {
            if (alive && url) {
              setIconsMap((prev) => ({ ...prev, [path]: url }))
            }
          })
          .catch((err: unknown) => console.warn('[ClipRow] getSubFileIcon err', err))
      })
    }

    return () => {
      alive = false
    }
  }, [filePaths, item.type])

  const fileTitle = useMemo(() => {
    if (item.type !== 'file') return ''
    if (filePaths.length > 1) return `${filePaths.length} 个文件`
    return fileBaseName(filePaths[0]) || '未命名文件'
  }, [filePaths, item.type])

  const visibleFilePaths = expanded ? filePaths : filePaths.slice(0, 3)

  return (
    <li
      className={clsx('row', active && 'row-active')}
      onClick={onSelect}
      onDoubleClick={onCopy}
    >
      <div className="row__body">
        {/* 类型 1：单文件 —— 大系统图标与带下划线文件名链接 */}
        {item.type === 'file' && filePaths.length === 1 && (
          <div className="flex items-center gap-2.5 w-full my-0.5 min-w-0">
            <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
              {fileIconUrl ? (
                <img src={fileIconUrl} alt="" className="w-6.5 h-6.5 object-contain" />
              ) : isLikelyDirectory(filePaths[0]) ? (
                <Folder size={18} className="text-amber-400 fill-amber-400/10 shrink-0" />
              ) : (
                <File size={18} className="text-slate-300 shrink-0" />
              )}
            </div>
            <span className="file-link-title" title={filePaths[0]}>
              {fileTitle}
            </span>
          </div>
        )}

        {/* 类型 2：多文件 —— 极简 Explorer 列表 */}
        {item.type === 'file' && filePaths.length > 1 && (
          <div className={clsx('file-list', expanded && 'file-list--full')}>
            {visibleFilePaths.map((path) => {
              const isDir = isLikelyDirectory(path)
              const subIconUrl = iconsMap[path]
              return (
                <div className="file-list__row" key={path} title={path}>
                  {subIconUrl ? (
                    <img src={subIconUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
                  ) : isDir ? (
                    <Folder size={15} className="text-amber-400 fill-amber-400/15 shrink-0" />
                  ) : (
                    <File size={15} className="text-slate-300 shrink-0" />
                  )}
                  <span className="file-list__name">{fileBaseName(path)}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* 类型 3：图像 —— 居中带悬浮放缩提示微缩图 */}
        {item.type === 'image' && imagePath && (
          <div className="flex flex-col items-center w-full my-1">
            <button
              type="button"
              className="figure-center"
              onClick={(event) => {
                event.stopPropagation()
                onPreviewImage()
              }}
              title="点击查看大图"
            >
              <img src={fileUrl(imagePath)} alt="" loading="lazy" />
            </button>
          </div>
        )}

        {/* 类型 4：文本 —— 直排大字正文预览 */}
        {item.type === 'text' && (
          <div
            className={clsx(
              'row__content font-sans text-[13.5px] font-semibold text-slate-100 pl-0.5 tracking-wide leading-relaxed',
              expanded && 'row__content--full'
            )}
          >
            {expanded ? body : item.preview || body || '— 空内容 —'}
          </div>
        )}

        {item.externalStatus && (
          <div className="mt-1 text-[11px] font-medium text-rose-400">
            {externalStatusLabel(item.externalStatus)}
          </div>
        )}

        {/* 底部工具与时间栏 */}
        <div className="row__footer mt-1.5 flex justify-between items-center w-full select-none">
          <div className="flex items-center gap-2.5">
            <span className="text-slate-500 font-medium text-[11px] pl-0.5">
              {ago(item.createdAt)}
            </span>
            {canExpand && (
              <button
                type="button"
                className="expand-toggle-inline text-slate-500 hover:text-[var(--ac)] text-[11px] flex items-center gap-0.5 transition-colors"
                onClick={(event) => {
                  event.stopPropagation()
                  setExpanded((value) => !value)
                }}
              >
                <span>
                  {expanded
                    ? '收起'
                    : item.type === 'file' && filePaths.length > 3
                      ? `还有 ${filePaths.length - 3} 个文件 · 展开`
                      : '展开'}
                </span>
                {expanded ? <ChevronUp size={10.5} /> : <ChevronDown size={10.5} />}
              </button>
            )}
          </div>

          <div className="flex items-center text-slate-500 text-[11px]">
            <span className="row__index font-mono text-[11.5px] text-slate-600 shrink-0">{index}</span>
          </div>
        </div>

        {/* 绝对定位 Hover 快捷操作按钮 */}
        <div className="row__actions">
          <button
            type="button"
            className="act"
            title="复制到剪贴板"
            onClick={(event) => {
              event.stopPropagation()
              onCopy()
            }}
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            className={clsx('act', item.favorite && 'act-fav-on')}
            title={item.favorite ? '取消收藏' : '收藏'}
            onClick={(event) => {
              event.stopPropagation()
              onFavorite()
            }}
          >
            <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="act act-danger"
            title="删除"
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </li>
  )
}

function externalStatusLabel(status: NonNullable<ClipItem['externalStatus']>): string {
  if (status === 'missing') return '源文件已删除'
  if (status === 'changed') return '源文件已发生变化'
  if (status === 'permission-denied') return '无权访问源文件'
  return '源文件当前不可用'
}

/* ───────────────────────── 辅助工具函数 ───────────────────────── */

function normalizedFilePaths(item: ClipItem): string[] {
  const paths = item.paths?.filter((path) => typeof path === 'string' && path.trim()) ?? []
  if (paths.length > 0) return paths
  return item.path ? [item.path] : []
}

function isLikelyDirectory(path?: string): boolean {
  if (!path) return false
  const name = path.split(/[\\/]/).pop() || ''
  const KNOWN_FOLDERS = new Set(['.vscode', '.git', '.github', '.idea', '.svn', 'node_modules'])
  if (KNOWN_FOLDERS.has(name.toLowerCase())) {
    return true
  }
  if (name.startsWith('.')) {
    return false
  }
  return !name.includes('.')
}

function fileBaseName(path?: string): string {
  if (!path) return ''
  return path.split(/[\\/]/).pop() || path
}

function fileUrl(p?: string): string {
  if (!p) return ''
  return 'file:///' + p.replaceAll('\\', '/')
}

function ago(ts: number): string {
  const sec = Math.round((ts - Date.now()) / 1000)
  const abs = Math.abs(sec)
  if (abs < 60) return rtf.format(sec, 'second')
  const min = Math.round(sec / 60)
  if (Math.abs(min) < 60) return rtf.format(min, 'minute')
  const hour = Math.round(min / 60)
  if (Math.abs(hour) < 24) return rtf.format(hour, 'hour')
  return rtf.format(Math.round(hour / 24), 'day')
}
