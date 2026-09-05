import type { ScanStatus } from './hooks/useDiskMap'

/** 树里还没有当前路径时的列表提示：区分「扫描还没到」与「不在扫描结果里」。 */
export function emptyHintFor(status: ScanStatus): string {
  switch (status) {
    case 'booting':
      return '正在启动扫描…'
    case 'scanning':
      return '扫描尚未到达此目录，稍后会自动出现'
    case 'done':
      return '此目录不在本次扫描结果里'
    case 'cancelled':
      return '扫描已取消，重新扫描后重试'
    case 'error':
      return '扫描出错，重新扫描后重试'
    case 'idle':
    default:
      return '等待扫描…'
  }
}
