import { QrCode, Scan } from '@phosphor-icons/react'
import { useCallback, useState } from 'react'
import { DecodePanel } from './components/DecodePanel'
import { GeneratePanel } from './components/GeneratePanel'
import { HistorySidebar } from './components/HistorySidebar'
import { Toast, type ToastState } from './components/Toast'
import { useDecodeWorkspace } from './hooks/useDecodeWorkspace'
import { useGenerateWorkspace } from './hooks/useGenerateWorkspace'
import { useHistory } from './hooks/useHistory'
import type { AppMode, HistoryItem } from './types'

export function App() {
  const { items, push, remove, clear } = useHistory()
  const [mode, setMode] = useState<AppMode>('decode')
  const [selectedDecodeId, setSelectedDecodeId] = useState<string | null>(null)
  const [selectedGenerateId, setSelectedGenerateId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((kind: ToastState['kind'], text: string) => {
    setToast({ kind, text })
  }, [])

  const decode = useDecodeWorkspace({
    push,
    onToast: showToast,
    onHistorySelect: setSelectedDecodeId,
  })

  const generate = useGenerateWorkspace({
    push,
    onToast: showToast,
    onHistorySelect: setSelectedGenerateId,
  })

  const restoreDecode = decode.restoreFromHistory
  const restoreGenerate = generate.restoreFromHistory

  const onSelectHistory = useCallback(
    (item: HistoryItem) => {
      // 只回填对应工作区，另一侧状态完整保留
      if (item.kind === 'decode') {
        setMode('decode')
        setSelectedDecodeId(item.id)
        restoreDecode(item)
        return
      }
      setMode('generate')
      setSelectedGenerateId(item.id)
      restoreGenerate(item)
    },
    [restoreDecode, restoreGenerate],
  )

  const selectedId = mode === 'decode' ? selectedDecodeId : selectedGenerateId

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--bg-0)]">
      <HistorySidebar
        items={items}
        selectedId={selectedId}
        activeKind={mode}
        onSelect={onSelectHistory}
        onRemove={(id) => {
          remove(id)
          if (selectedDecodeId === id) setSelectedDecodeId(null)
          if (selectedGenerateId === id) setSelectedGenerateId(null)
        }}
        onClear={() => {
          clear()
          setSelectedDecodeId(null)
          setSelectedGenerateId(null)
          showToast('info', '已清空历史')
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-1)]/90 px-4 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-[var(--ac-line)] bg-[var(--ac-soft)] text-[var(--ac)]">
              <QrCode size={16} weight="bold" />
            </div>
            <span className="text-[13.5px] font-semibold tracking-tight text-[var(--fg)]">
              二维码工具
            </span>
          </div>

          <div className="ml-4 flex rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-sunken)] p-0.5">
            <button
              type="button"
              onClick={() => setMode('decode')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition ${
                mode === 'decode'
                  ? 'bg-[var(--bg-3)] text-[var(--fg)] shadow-sm'
                  : 'text-[var(--fg-dim)] hover:text-[var(--fg-muted)]'
              }`}
            >
              <Scan size={15} weight={mode === 'decode' ? 'bold' : 'regular'} />
              解析
            </button>
            <button
              type="button"
              onClick={() => setMode('generate')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition ${
                mode === 'generate'
                  ? 'bg-[var(--bg-3)] text-[var(--fg)] shadow-sm'
                  : 'text-[var(--fg-dim)] hover:text-[var(--fg-muted)]'
              }`}
            >
              <QrCode size={15} weight={mode === 'generate' ? 'bold' : 'regular'} />
              生成
            </button>
          </div>

          <div className="ml-auto text-[11.5px] text-[var(--fg-dim)]">
            {mode === 'decode' ? '拖放 / 选择 / Ctrl+V' : '输入文本后生成'}
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className={
              mode === 'decode'
                ? 'absolute inset-0 z-10 overflow-auto'
                : 'pointer-events-none invisible absolute inset-0 z-0 overflow-auto'
            }
            aria-hidden={mode !== 'decode'}
          >
            <DecodePanel
              active={mode === 'decode'}
              busy={decode.busy}
              previewUrl={decode.previewUrl}
              resultText={decode.resultText}
              errorMessage={decode.errorMessage}
              onFile={(f) => void decode.run(f)}
              onToast={showToast}
            />
          </div>
          <div
            className={
              mode === 'generate'
                ? 'absolute inset-0 z-10 overflow-auto'
                : 'pointer-events-none invisible absolute inset-0 z-0 overflow-auto'
            }
            aria-hidden={mode !== 'generate'}
          >
            <GeneratePanel
              text={generate.text}
              size={generate.size}
              margin={generate.margin}
              errorCorrection={generate.errorCorrection}
              moduleStyle={generate.moduleStyle}
              darkColor={generate.darkColor}
              lightColor={generate.lightColor}
              busy={generate.busy}
              dataUrl={generate.dataUrl}
              outputPath={generate.outputPath}
              errorMessage={generate.errorMessage}
              onTextChange={generate.setText}
              onSizeChange={generate.setSize}
              onMarginChange={generate.setMargin}
              onEcChange={generate.setErrorCorrection}
              onModuleStyleChange={generate.setModuleStyle}
              onDarkColorChange={generate.setDarkColor}
              onLightColorChange={generate.setLightColor}
              onGenerate={() => void generate.run()}
              onToast={showToast}
            />
          </div>
        </main>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
