import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Shell } from './components/Shell'
import { ToolRail } from './components/ToolRail'
import { OptionsPanel } from './components/OptionsPanel'
import { Workspace } from './components/Workspace'
import { ProcessBar } from './components/ProcessBar'
import { Toast } from './components/Toast'
import { getDefaultOptions } from './config/tools'
import { openFolder } from './lib/bridge'
import { useFiles } from './hooks/useFiles'
import { useManualCrop } from './hooks/useManualCrop'
import { useProcessImage } from './hooks/useProcessImage'
import type {
  ActionId,
  CommonOptions,
  CropMode,
  OutputStrategy,
  ToastState,
} from './types'

function parseAspect(ratio: unknown): number | null {
  if (ratio === '1:1') return 1
  if (ratio === '4:3') return 4 / 3
  if (ratio === '16:9') return 16 / 9
  return null
}

export function App() {
  const [activeAction, setActiveAction] = useState<ActionId>('compress')
  const [options, setOptions] = useState<Record<string, unknown>>(() =>
    getDefaultOptions('compress'),
  )
  const [cropMode, setCropMode] = useState<CropMode>('numeric')
  const [output, setOutput] = useState<OutputStrategy>({
    mode: 'sidecar',
    overwrite: false,
  })
  const [common, setCommon] = useState<CommonOptions>({
    autoOrient: true,
    stripMetadata: false,
  })
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimer = useRef<number | null>(null)

  const { files, addFiles, removeFile, clearFiles } = useFiles()
  const { rect: cropRect, setRect: setCropRect } = useManualCrop()
  const processState = useProcessImage()

  const showToast = useCallback(
    (message: string, kind: ToastState['kind'] = 'success') => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      setToast({ id: Date.now(), message, kind })
      toastTimer.current = window.setTimeout(() => setToast(null), 2800)
    },
    [],
  )

  const selectAction = useCallback((id: ActionId) => {
    setActiveAction(id)
    setOptions(getDefaultOptions(id))
    if (id !== 'crop') setCropMode('numeric')
  }, [])

  const handleAddFiles = useCallback(
    (list: FileList | File[]) => {
      const { added, skipped } = addFiles(list)
      if (added > 0) showToast(`已载入 ${added} 张图片`)
      else if (skipped > 0) showToast('文件已在列表中或格式不支持', 'info')
      else showToast('未识别到有效图片', 'error')
    },
    [addFiles, showToast],
  )

  // Surface process errors via toast
  useEffect(() => {
    if (processState.status === 'error' && processState.error) {
      showToast(processState.error, 'error')
    }
    if (processState.status === 'success' && processState.result) {
      const { summary } = processState.result
      if (summary.failed === 0) {
        showToast(`全部完成 · ${summary.succeeded} 张`)
      } else {
        showToast(
          `完成 ${summary.succeeded} 张，失败 ${summary.failed} 张`,
          summary.succeeded === 0 ? 'error' : 'info',
        )
      }
    }
  }, [processState.status, processState.error, processState.result, showToast])

  const cropAspect = useMemo(
    () => parseAspect(options.cropRatio),
    [options.cropRatio],
  )

  const handleProcess = () => {
    processState.process({
      action: activeAction,
      files,
      formOptions: options,
      output,
      common,
      cropMode,
      cropRect,
      onValidateError: (msg) => showToast(msg, 'error'),
    })
  }

  const handleOpenFolder = async () => {
    if (!processState.lastOutputPath) {
      showToast('请先成功处理至少一张图片', 'error')
      return
    }
    const r = await openFolder(processState.lastOutputPath)
    if (r.ok) showToast('已打开输出目录')
    else showToast(r.error || '打开目录失败', 'error')
  }

  return (
    <Shell
      fileCount={files.length}
      output={output}
      onOutputChange={setOutput}
      common={common}
      onCommonChange={setCommon}
    >
      <ToolRail activeAction={activeAction} onSelect={selectAction} />
      <OptionsPanel
        action={activeAction}
        options={options}
        onChange={setOptions}
        cropMode={cropMode}
        onCropModeChange={setCropMode}
        cropRect={cropRect}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Workspace
          action={activeAction}
          files={files}
          onAddFiles={handleAddFiles}
          onRemoveFile={removeFile}
          cropMode={cropMode}
          cropRect={cropRect}
          onCropChange={setCropRect}
          cropAspect={cropAspect}
          result={processState.result}
          lastOutputPath={processState.lastOutputPath}
          onToast={showToast}
          isRunning={processState.isRunning}
          progress={processState.progress}
          progressMessage={processState.progressMessage}
        />
        <ProcessBar
          fileCount={files.length}
          isRunning={processState.isRunning}
          progress={processState.progress}
          progressMessage={processState.progressMessage}
          canOpenFolder={!!processState.lastOutputPath}
          onClear={() => {
            clearFiles()
            showToast('已清空文件列表', 'info')
          }}
          onOpenFolder={handleOpenFolder}
          onProcess={handleProcess}
        />
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Shell>
  )
}
