import { useCallback, useEffect, useRef, useState } from 'react'
import { getPathForFile } from '../lib/bridge'
import type { LocalFile } from '../types'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|avif|gif|bmp|tiff?|svg)$/i.test(file.name)
}

export function useFiles() {
  const [files, setFiles] = useState<LocalFile[]>([])
  const filesRef = useRef(files)
  filesRef.current = files

  const revokeAll = useCallback((list: LocalFile[]) => {
    for (const item of list) {
      try {
        URL.revokeObjectURL(item.previewUrl)
      } catch {
        /* ignore */
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      revokeAll(filesRef.current)
    }
  }, [revokeAll])

  const addFiles = useCallback(
    (fileList: FileList | File[] | null | undefined) => {
      if (!fileList || fileList.length === 0) {
        return { added: 0, skipped: 0 }
      }

      const incoming = Array.from(fileList).filter(isImageFile)
      if (incoming.length === 0) {
        return { added: 0, skipped: fileList.length }
      }

      const prev = filesRef.current
      const next = [...prev]
      const pathSet = new Set(prev.map((f) => f.absPath).filter(Boolean))
      const nameSizeSet = new Set(prev.map((f) => `${f.name}:${f.size}`))
      let added = 0
      let skipped = 0

      for (const file of incoming) {
        const absPath = getPathForFile(file)
        if (absPath && pathSet.has(absPath)) {
          skipped += 1
          continue
        }
        if (!absPath && nameSizeSet.has(`${file.name}:${file.size}`)) {
          skipped += 1
          continue
        }

        const item: LocalFile = {
          id: makeId(),
          file,
          absPath: absPath || file.name,
          name: file.name,
          size: file.size,
          previewUrl: URL.createObjectURL(file),
        }
        next.push(item)
        if (absPath) pathSet.add(absPath)
        nameSizeSet.add(`${file.name}:${file.size}`)
        added += 1
      }

      if (added > 0) setFiles(next)
      return { added, skipped }
    },
    [],
  )

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id)
      if (target) {
        try {
          URL.revokeObjectURL(target.previewUrl)
        } catch {
          /* ignore */
        }
      }
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const clearFiles = useCallback(() => {
    setFiles((prev) => {
      revokeAll(prev)
      return []
    })
  }, [revokeAll])

  const reorderFiles = useCallback((fromIndex: number, toIndex: number) => {
    setFiles((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev
      }
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
  }, [])

  return {
    files,
    addFiles,
    removeFile,
    clearFiles,
    reorderFiles,
  }
}
