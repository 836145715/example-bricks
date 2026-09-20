import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { profileLabel, profileTarget } from '../state/manager-state'
import type { AuthType, HostDraft } from '../types'

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('grid gap-1.5', wide && 'col-span-2')}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function HostEditor({
  draft,
  mode,
  busy,
  testMessage,
  onChange,
  onClose,
  onDelete,
  onTest,
  onSave
}: {
  draft: HostDraft
  mode: 'create' | 'edit'
  busy: string | null
  testMessage: string
  onChange: (patch: Partial<HostDraft>) => void
  onClose: () => void
  onDelete?: () => void
  onTest: () => void
  onSave: () => void
}) {
  const saving = busy === 'save'
  const testing = busy === 'test'
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? '编辑 Profile' : '新建 Profile'}</DialogTitle>
          <DialogDescription className="font-mono">
            {profileLabel(draft) || '新主机'} · {profileTarget(draft)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label="名称">
            <Input
              value={draft.name || ''}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="可选"
            />
          </Field>
          <Field label="分组">
            <Input
              value={draft.group || ''}
              onChange={(e) => onChange({ group: e.target.value })}
              placeholder="生产 / 测试 / 跳板"
            />
          </Field>
          <Field label="主机地址">
            <Input
              value={draft.host}
              onChange={(e) => onChange({ host: e.target.value })}
              placeholder="host.example.com"
            />
          </Field>
          <Field label="端口">
            <Input
              type="number"
              min={1}
              max={65535}
              value={draft.port || 22}
              onChange={(e) => onChange({ port: Number(e.target.value) || 22 })}
            />
          </Field>
          <Field label="用户名">
            <Input value={draft.user} onChange={(e) => onChange({ user: e.target.value })} />
          </Field>
          <Field label="认证方式">
            <Select
              value={draft.authType}
              onValueChange={(value) => onChange({ authType: value as AuthType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">密码</SelectItem>
                <SelectItem value="key">私钥</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {draft.authType === 'password' ? (
            <Field label="密码" wide>
              <Input
                type="password"
                autoComplete="off"
                value={draft.password || ''}
                onChange={(e) => onChange({ password: e.target.value })}
                placeholder={draft.id ? '留空保留已保存密码' : '输入密码'}
              />
            </Field>
          ) : (
            <>
              <Field label="私钥文件" wide>
                <Input
                  className="font-mono text-xs"
                  value={draft.keyPath || ''}
                  onChange={(e) => onChange({ keyPath: e.target.value })}
                  placeholder="~/.ssh/id_ed25519"
                />
              </Field>
              <Field label="私钥内容" wide>
                <Textarea
                  rows={4}
                  className="font-mono text-xs"
                  value={draft.keyText || ''}
                  onChange={(e) => onChange({ keyText: e.target.value })}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                />
              </Field>
              <Field label="Passphrase" wide>
                <Input
                  type="password"
                  autoComplete="off"
                  value={draft.passphrase || ''}
                  onChange={(e) => onChange({ passphrase: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="标签" wide>
            <Input
              value={(draft.tags || []).join(', ')}
              onChange={(e) =>
                onChange({
                  tags: e.target.value
                    .split(/[,，]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                })
              }
              placeholder="逗号分隔，如：生产, 新加坡"
            />
          </Field>
          <Field label="备注" wide>
            <Textarea
              rows={2}
              value={draft.note || ''}
              onChange={(e) => onChange({ note: e.target.value })}
            />
          </Field>
        </div>

        {testMessage ? (
          <p className="text-muted-foreground font-mono text-xs">{testMessage}</p>
        ) : null}

        <DialogFooter>
          {onDelete ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive mr-auto"
              disabled={Boolean(busy)}
              onClick={onDelete}
            >
              {busy === 'delete' ? <Loader2 className="animate-spin" /> : null}
              删除
            </Button>
          ) : null}
          <Button variant="outline" disabled={Boolean(busy)} onClick={onTest}>
            {testing ? <Loader2 className="animate-spin" /> : null}
            测试连接
          </Button>
          <Button disabled={Boolean(busy)} onClick={onSave}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
