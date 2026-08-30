import type { SftpProgress, TransferState } from '../types'

export function formatBytes(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function fileName(path?: string): string {
  if (!path) return ''
  const parts = path.replaceAll('\\', '/').split('/')
  return parts.filter(Boolean).pop() ?? path
}

export function transferLine(state: TransferState): string {
  const name = fileName(state.currentPath) || '文件'
  const verb = state.phase === 'download' ? '下载' : '上传'
  if (state.status === 'error') return state.message || `${verb}失败`
  if (state.status === 'ok') return `${verb}完成 ${name}`
  if (state.phase === 'connecting') return '正在连接…'
  if (state.phase === 'scanning') return '正在扫描文件…'
  const size =
    state.totalBytes && state.totalBytes > 0
      ? `${formatBytes(state.bytes)} / ${formatBytes(state.totalBytes)}`
      : formatBytes(state.bytes)
  const percent = state.percent != null ? `  ${state.percent}%` : ''
  const files =
    state.fileCount && state.fileCount > 1 && state.fileIndex
      ? `  第 ${state.fileIndex} / ${state.fileCount} 个`
      : ''
  return `${verb} ${name}  ${size}${percent}${files}`
}

export function progressToTransfer(progress: SftpProgress, fallback: Partial<TransferState> = {}): TransferState {
  return {
    status: progress.phase === 'error' ? 'error' : 'running',
    phase: progress.phase,
    bytes: progress.bytes,
    totalBytes: progress.totalBytes,
    percent: progress.percent,
    currentPath: progress.currentPath ?? fallback.currentPath,
    remotePath: progress.remotePath ?? fallback.remotePath,
    remoteDir: fallback.remoteDir ?? '',
    fileIndex: progress.fileIndex,
    fileCount: progress.fileCount,
    message: fallback.message ?? ''
  }
}
