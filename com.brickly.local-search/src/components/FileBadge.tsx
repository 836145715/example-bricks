import {
  Archive,
  AudioLines,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Presentation
} from 'lucide-react'
import type { SearchItem } from '../types'

export function FileBadge({ item, size = 18 }: { item: SearchItem; size?: number }) {
  if (item.isFolder) {
    return <Folder size={size} style={{ color: '#eab308' }} />
  }
  const ext = item.extension.toLowerCase()
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return <FileSpreadsheet size={size} style={{ color: '#10b981' }} />
  }
  if (['doc', 'docx'].includes(ext)) {
    return <FileText size={size} style={{ color: '#3b82f6' }} />
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return <Presentation size={size} style={{ color: '#f97316' }} />
  }
  if (ext === 'pdf') {
    return <FileText size={size} style={{ color: '#ef4444' }} />
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return <FileImage size={size} style={{ color: '#ec4899' }} />
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
    return <Film size={size} style={{ color: '#8b5cf6' }} />
  }
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) {
    return <AudioLines size={size} style={{ color: '#06b6d4' }} />
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <Archive size={size} style={{ color: '#a855f7' }} />
  }
  return <File size={size} style={{ color: '#94a3b8' }} />
}
