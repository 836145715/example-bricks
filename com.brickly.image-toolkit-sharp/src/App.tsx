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

const AUTO_PREVIEW_MS = 400

export function App() {
  const [activeAction, setActiveAction] = useState<ActionId>('compress')
  const [options, setOptions] = useState<Record<string, unknown>>(() =>
    getDefaultOptions('compress'),
  )
  const [cropMode, setCropMode] = useState<CropMode>('drag')
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
  const [selectedResultIndex, setSelectedResultIndex] = useState(0)

  const { files, addFiles, removeFile, clearFiles } = useFiles()
  const { rect: cropRect, setRect: setCropRect } = useManualCrop()
  const {
    process,
    preview,
    resetResult,
    isRunning,
    status,
    progress,
    progressMessage,
    result,
    error,
    lastOutputPath,
    lastWasPreviewOnly,
    lastSilent,
  } = useProcessImage()

  const autoPreviewTimer = useRef<number | null>(null)

  const showToast = useCallback(
    (message: string, kind: ToastState['kind'] = 'success') => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      setToast({ id: Date.now(), message, kind })
      toastTimer.current = window.setTimeout(() => setToast(null), 2600)
    },
    [],
  )

  const cropAspect = useMemo(
    () => parseAspect(options.cropRatio),
    [options.cropRatio],
  )

  const runParams = useMemo(
    () => ({
      action: activeAction,
      files,
      formOptions: options,
      output,
      common,
      cropMode,
      cropRect,
      onValidateError: (msg: string) => showToast(msg, 'error'),
    }),
    [activeAction, files, options, output, common, cropMode, cropRect, showToast],
  )

  // Debounced auto-preview (skip PDF — no useful image preview)
  // Crop: slightly longer debounce so box isn't fighting network mid-drag
  useEffect(() => {
    if (files.length === 0) return
    if (activeAction === 'pdf') return

    const delay = activeAction === 'crop' ? 550 : AUTO_PREVIEW_MS
    if (autoPreviewTimer.current) window.clearTimeout(autoPreviewTimer.current)
    autoPreviewTimer.current = window.setTimeout(() => {
      preview({ ...runParams, silent: true })
    }, delay)

    return () => {
      if (autoPreviewTimer.current) window.clearTimeout(autoPreviewTimer.current)
    }
  }, [
    activeAction,
    options,
    common.autoOrient,
    common.stripMetadata,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height,
    files,
    preview,
    runParams,
  ])

  useEffect(() => {
    if (status !== 'success' || !result) return
    const idx = result.items.findIndex((i) => i.ok && i.previewDataUrl)
    if (idx >= 0) setSelectedResultIndex(idx)
  }, [status, result])

  const selectAction = useCallback((id: ActionId) => {
    setActiveAction(id)
    setOptions(getDefaultOptions(id))
    if (id === 'crop') setCropMode('drag')
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

  useEffect(() => {
    if (status === 'error' && error) {
      showToast(error, 'error')
      return
    }
    if (status !== 'success' || !result) return
    if (lastSilent) return

    const { summary } = result
    const isPreview = lastWasPreviewOnly || !!summary.previewOnly
    const hasOk = (summary.succeeded ?? 0) > 0
    const hasFail = (summary.failed ?? 0) > 0

    if (isPreview) {
      if (hasOk) {
        const hit = result.items.find((i) => i.ok && i.previewDataUrl)
        if (!hit?.previewDataUrl) {
          showToast('预览完成，但未返回预览图数据', 'error')
        } else if (hit.inputSizeKb != null && hit.sizeKb != null) {
          showToast(`预览 · ${hit.inputSizeKb} KB → ${hit.sizeKb} KB`)
        }
      } else if (hasFail) {
        const firstErr = result.items.find((i) => !i.ok)?.error
        showToast(firstErr?.message || `预览失败 · ${summary.failed} 项`, 'error')
      }
      return
    }

    if (!hasFail) {
      showToast(`已保存 · ${summary.succeeded} 张`)
    } else if (hasOk) {
      showToast(`完成 ${summary.succeeded} 张，失败 ${summary.failed} 张`, 'info')
    } else {
      const firstErr = result.items.find((i) => !i.ok)?.error
      showToast(firstErr?.message || `保存失败 · ${summary.failed} 张`, 'error')
    }
  }, [status, error, result, lastWasPreviewOnly, lastSilent, showToast])

  const handleProcess = () => {
    if (autoPreviewTimer.current) window.clearTimeout(autoPreviewTimer.current)
    process(runParams)
  }

  const handlePreview = () => {
    if (autoPreviewTimer.current) window.clearTimeout(autoPreviewTimer.current)
    preview({ ...runParams, silent: false })
  }

  const handleOpenFolder = async () => {
    if (!lastOutputPath) {
      showToast('请先成功保存至少一张图片', 'error')
      return
    }
    const r = await openFolder(lastOutputPath)
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
          result={result}
          lastOutputPath={lastOutputPath}
          onToast={showToast}
          isRunning={isRunning}
          progress={progress}
          progressMessage={progressMessage}
          selectedResultIndex={selectedResultIndex}
          onSelectResultIndex={setSelectedResultIndex}
        />
        <ProcessBar
          fileCount={files.length}
          isRunning={isRunning}
          progress={progress}
          progressMessage={progressMessage}
          canOpenFolder={!!lastOutputPath}
          previewDisabled={activeAction === 'pdf'}
          onClear={() => {
            if (autoPreviewTimer.current) window.clearTimeout(autoPreviewTimer.current)
            resetResult()
            clearFiles()
            setSelectedResultIndex(0)
            showToast('已清空文件列表', 'info')
          }}
          onOpenFolder={handleOpenFolder}
          onPreview={handlePreview}
          onProcess={handleProcess}
        />
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Shell>
  )
}
