import { useCallback, useRef, useState } from 'react'
import { buildActionOptions } from '../config/tools'
import { streamProcessImage } from '../lib/bridge'
import type {
  ActionId,
  CommonOptions,
  CropMode,
  CropRect,
  LocalFile,
  OutputStrategy,
  ProcessImageResult,
} from '../types'

export type ProcessStatus = 'idle' | 'running' | 'success' | 'error'

function normalizeProcessResult(raw: unknown): ProcessImageResult {
  if (!raw || typeof raw !== 'object') {
    return { items: [], summary: { total: 0, succeeded: 0, failed: 0 } }
  }
  const obj = raw as Record<string, unknown>
  // Nested: { result: { items, summary } }
  if (obj.result && typeof obj.result === 'object') {
    const inner = obj.result as ProcessImageResult
    if (Array.isArray(inner.items)) return inner
  }
  if (Array.isArray(obj.items)) {
    return obj as unknown as ProcessImageResult
  }
  return { items: [], summary: { total: 0, succeeded: 0, failed: 0 } }
}

export interface UseProcessImageState {
  status: ProcessStatus
  progress: number
  progressMessage: string
  result: ProcessImageResult | null
  error: string | null
  lastOutputPath: string | null
  /** Last run was memory-only preview */
  lastWasPreviewOnly: boolean
}

export function useProcessImage() {
  const [state, setState] = useState<UseProcessImageState>({
    status: 'idle',
    progress: 0,
    progressMessage: '',
    result: null,
    error: null,
    lastOutputPath: null,
    lastWasPreviewOnly: false,
  })
  const runningRef = useRef(false)

  const resetResult = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: 'idle',
      progress: 0,
      progressMessage: '',
      result: null,
      error: null,
      lastWasPreviewOnly: false,
    }))
  }, [])

  const run = useCallback(
    (params: {
      action: ActionId
      files: LocalFile[]
      formOptions: Record<string, unknown>
      output: OutputStrategy
      common: CommonOptions
      cropMode?: CropMode
      cropRect?: CropRect
      previewOnly?: boolean
      onValidateError?: (message: string) => void
    }) => {
      if (runningRef.current) return

      const {
        action,
        files,
        formOptions,
        output,
        common,
        cropMode,
        cropRect,
        previewOnly = false,
        onValidateError,
      } = params

      if (files.length === 0) {
        onValidateError?.('请先添加需要处理的图片')
        return
      }

      if (previewOnly && action === 'pdf') {
        onValidateError?.('合并 PDF 不支持纯内存预览，请直接「处理」保存')
        return
      }

      if (action === 'watermark' && formOptions.type === 'image') {
        if (!String(formOptions.watermarkFile || '').trim()) {
          onValidateError?.('请先选择本地水印图片')
          return
        }
      }

      // Preview does not need output directory
      if (!previewOnly && output.mode === 'dir' && !String(output.dir || '').trim()) {
        onValidateError?.('请指定输出目录，或改用同目录旁路输出')
        return
      }

      const options = buildActionOptions(action, formOptions, cropRect, cropMode)
      const paths = files.map((f) => f.absPath)

      runningRef.current = true
      setState((prev) => ({
        ...prev,
        status: 'running',
        progress: 0,
        progressMessage: previewOnly ? '内存预览中...' : '连接处理引擎...',
        error: null,
        lastWasPreviewOnly: previewOnly,
      }))

      streamProcessImage(
        {
          action,
          files: paths,
          options,
          output: previewOnly
            ? undefined
            : {
                mode: output.mode,
                dir: output.mode === 'dir' ? output.dir : undefined,
                overwrite: !!output.overwrite,
              },
          common: {
            autoOrient: common.autoOrient,
            stripMetadata: common.stripMetadata,
          },
          previewOnly,
        },
        {
          onProgress: (p, message) => {
            const pct = Math.max(0, Math.min(100, Math.round((p ?? 0) * 100)))
            setState((prev) => ({
              ...prev,
              progress: pct,
              progressMessage: message || prev.progressMessage,
            }))
          },
          onResult: (raw) => {
            runningRef.current = false
            // Normalize possible host wrappers: { items, summary } | { result: {...} }
            const result = normalizeProcessResult(raw)
            const isPreview =
              previewOnly || !!result.summary?.previewOnly
            const lastOk = [...(result.items || [])]
              .reverse()
              .find((item) => item.ok && item.outputPath)

            setState((prev) => ({
              ...prev,
              status: 'success',
              progress: 100,
              progressMessage: isPreview ? '预览完成（未保存）' : '处理完成',
              result,
              error: null,
              lastWasPreviewOnly: isPreview,
              // Only update saved path when actually written to disk
              lastOutputPath: isPreview
                ? prev.lastOutputPath
                : lastOk?.outputPath || prev.lastOutputPath,
            }))
          },
          onError: (err) => {
            runningRef.current = false
            setState((prev) => ({
              ...prev,
              status: 'error',
              progress: 0,
              progressMessage: '',
              error: err.message || (previewOnly ? '预览失败' : '处理失败'),
              lastWasPreviewOnly: previewOnly,
            }))
          },
        },
      )
    },
    [],
  )

  const process = useCallback(
    (params: Omit<Parameters<typeof run>[0], 'previewOnly'>) =>
      run({ ...params, previewOnly: false }),
    [run],
  )

  const preview = useCallback(
    (params: Omit<Parameters<typeof run>[0], 'previewOnly'>) =>
      run({ ...params, previewOnly: true }),
    [run],
  )

  return {
    ...state,
    process,
    preview,
    resetResult,
    isRunning: state.status === 'running',
  }
}
