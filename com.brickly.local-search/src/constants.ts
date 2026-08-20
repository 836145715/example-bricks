import {
  Archive,
  AudioLines,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Presentation,
  Search
} from 'lucide-react'
import type { SearchCategory, SearchResult, SearchSort } from './types'

export const categories: Array<{ id: SearchCategory; label: string; icon: typeof Search; color: string }> = [
  { id: 'all', label: '全部', icon: Search, color: '#2f9d8a' },
  { id: 'file', label: '文件', icon: File, color: '#94a3b8' },
  { id: 'folder', label: '文件夹', icon: Folder, color: '#eab308' },
  { id: 'excel', label: 'EXCEL', icon: FileSpreadsheet, color: '#10b981' },
  { id: 'word', label: 'WORD', icon: FileText, color: '#3b82f6' },
  { id: 'ppt', label: 'PPT', icon: Presentation, color: '#f97316' },
  { id: 'pdf', label: 'PDF', icon: FileText, color: '#ef4444' },
  { id: 'image', label: '图片', icon: FileImage, color: '#ec4899' },
  { id: 'video', label: '视频', icon: Film, color: '#8b5cf6' },
  { id: 'audio', label: '音频', icon: AudioLines, color: '#06b6d4' },
  { id: 'archive', label: '压缩文件', icon: Archive, color: '#a855f7' }
]

export const sortOptions: Array<{ value: SearchSort; label: string }> = [
  { value: 'name_asc', label: '名称升序' },
  { value: 'name_desc', label: '名称降序' },
  { value: 'date_desc', label: '修改时间新到旧' },
  { value: 'date_asc', label: '修改时间旧到新' },
  { value: 'size_desc', label: '大小降序' },
  { value: 'size_asc', label: '大小升序' },
  { value: 'path_asc', label: '路径升序' },
  { value: 'path_desc', label: '路径降序' },
  { value: 'ext_asc', label: '扩展名升序' },
  { value: 'ext_desc', label: '扩展名降序' }
]

export const emptyResult: SearchResult = {
  query: '',
  effectiveQuery: '*',
  category: 'all',
  categoryLabel: '全部',
  total: 0,
  offset: 0,
  limit: 50,
  items: []
}
