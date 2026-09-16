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
  lastWasPreviewOnly: boolean
  /** Suppress success toast (auto-preview) */
  lastSilent: boolean
}

export type RunParams = {
  action: ActionId
  files: LocalFile[]
  formOptions: Record<string, unknown>
  output: OutputStrategy
  common: CommonOptions
  cropMode?: CropMode
  cropRect?: CropRect
  previewOnly?: boolean
  /** Auto-preview: no success toast */
  silent?: boolean
  onValidateError?: (message: string) => void
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
    lastSilent: false,
  })
  const runningRef = useRef(false)
  const genRef = useRef(0)

  const resetResult = useCallback(() => {
    genRef.current += 1
    runningRef.current = false
    setState((prev) => ({
      ...prev,
      status: 'idle',
      progress: 0,
      progressMessage: '',
      result: null,
      error: null,
      lastWasPreviewOnly: false,
      lastSilent: false,
    }))
  }, [])

  const run = useCallback((params: RunParams) => {
    const {
      action,
      files,
      formOptions,
      output,
      common,
      cropMode,
      cropRect,
      previewOnly = false,
      silent = false,
      onValidateError,
    } = params

    if (files.length === 0) {
      onValidateError?.('请先添加需要处理的图片')
      return
    }

    if (previewOnly && action === 'pdf') {
      if (!silent) onValidateError?.('合并 PDF 不支持自动预览，请直接保存')
      return
    }

    if (action === 'watermark' && formOptions.type === 'image') {
      if (!String(formOptions.watermarkFile || '').trim()) {
        if (!silent) onValidateError?.('请先选择本地水印图片')
        return
      }
    }

    if (!previewOnly && output.mode === 'dir' && !String(output.dir || '').trim()) {
      onValidateError?.('请指定输出目录，或改用同目录旁路输出')
      return
    }

    // Save must wait; auto-preview may supersede a previous preview
    if (runningRef.current && !previewOnly) return

    const options = buildActionOptions(action, formOptions, cropRect, cropMode)
    const paths = files.map((f) => f.absPath)
    const gen = ++genRef.current

    runningRef.current = true
    setState((prev) => ({
      ...prev,
      status: 'running',
      progress: 0,
      progressMessage: previewOnly ? '更新预览…' : '处理中…',
      error: null,
      lastWasPreviewOnly: previewOnly,
      lastSilent: silent && previewOnly,
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
          if (gen !== genRef.current) return
          const pct = Math.max(0, Math.min(100, Math.round((p ?? 0) * 100)))
          setState((prev) => ({
            ...prev,
            progress: pct,
            progressMessage: message || prev.progressMessage,
          }))
        },
        onResult: (raw) => {
          if (gen !== genRef.current) return
          runningRef.current = false
          const result = normalizeProcessResult(raw)
          const isPreview = previewOnly || !!result.summary?.previewOnly
          const lastOk = [...(result.items || [])]
            .reverse()
            .find((item) => item.ok && item.outputPath)

          setState((prev) => ({
            ...prev,
            status: 'success',
            progress: 100,
            progressMessage: isPreview ? '预览已更新' : '已保存',
            result,
            error: null,
            lastWasPreviewOnly: isPreview,
            lastSilent: silent && isPreview,
            lastOutputPath: isPreview
              ? prev.lastOutputPath
              : lastOk?.outputPath || prev.lastOutputPath,
          }))
        },
        onError: (err) => {
          if (gen !== genRef.current) return
          runningRef.current = false
          setState((prev) => ({
            ...prev,
            status: 'error',
            progress: 0,
            progressMessage: '',
            error: err.message || (previewOnly ? '预览失败' : '处理失败'),
            lastWasPreviewOnly: previewOnly,
            lastSilent: false,
          }))
        },
      },
    )
  }, [])

  const process = useCallback(
    (params: Omit<RunParams, 'previewOnly' | 'silent'>) =>
      run({ ...params, previewOnly: false, silent: false }),
    [run],
  )

  const preview = useCallback(
    (params: Omit<RunParams, 'previewOnly'> & { silent?: boolean }) =>
      run({ ...params, previewOnly: true, silent: !!params.silent }),
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
