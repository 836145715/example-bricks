import { Plus, Trash2 } from 'lucide-react'
import type { NameValue } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface KeyValueEditorProps {
  value: NameValue[]
  onChange: (next: NameValue[]) => void
  namePlaceholder?: string
  valuePlaceholder?: string
}

export function KeyValueEditor({
  value,
  onChange,
  namePlaceholder = 'Name',
  valuePlaceholder = 'Value',
}: KeyValueEditorProps) {
  const updateRow = (index: number, patch: Partial<NameValue>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const addRow = () => {
    onChange([...value, { name: '', value: '' }])
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">暂无条目，点击下方添加</p>
      )}
      {value.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={row.name}
            onChange={(e) => updateRow(index, { name: e.target.value })}
            placeholder={namePlaceholder}
            className="font-mono text-xs h-8 flex-1 min-w-0"
          />
          <Input
            value={row.value}
            onChange={(e) => updateRow(index, { value: e.target.value })}
            placeholder={valuePlaceholder}
            className="font-mono text-xs h-8 flex-[1.4] min-w-0"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeRow(index)}
            aria-label="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    </div>
  )
}
