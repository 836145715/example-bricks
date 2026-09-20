import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ConfirmState } from '../types'

export function ConfirmDialog({
  confirm,
  onConfirm,
  onCancel
}: {
  confirm: ConfirmState
  onConfirm: () => void
  onCancel: () => void
}) {
  const title = confirm.kind === 'path' ? '上传这个路径？' : '覆盖已存在的文件？'
  const detail = confirm.kind === 'path' ? confirm.path : confirm.remotePath || confirm.localPath || ''
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{detail}</DialogDescription>
        </DialogHeader>
        {confirm.remoteDir ? (
          <p className="text-muted-foreground text-xs">远端目录 {confirm.remoteDir}</p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm}>{confirm.kind === 'overwrite' ? '覆盖' : '上传'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
