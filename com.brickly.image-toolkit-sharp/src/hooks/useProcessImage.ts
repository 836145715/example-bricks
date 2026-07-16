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

export interface UseProcessImageState {
  status: ProcessStatus
  progress: number
  progressMessage: string
  result: ProcessImageResult | null
  error: string | null
  lastOutputPath: string | null
}

export function useProcessImage() {
  const [state, setState] = useState<UseProcessImageState>({
    status: 'idle',
    progress: 0,
    progressMessage: '',
    result: null,
    error: null,
    lastOutputPath: null,
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
    }))
  }, [])

  const process = useCallback(
    (params: {
      action: ActionId
      files: LocalFile[]
      formOptions: Record<string, unknown>
      output: OutputStrategy
      common: CommonOptions
      cropMode?: CropMode
      cropRect?: CropRect
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
        onValidateError,
      } = params

      if (files.length === 0) {
        onValidateError?.('请先添加需要处理的图片')
        return
      }

      if (action === 'watermark' && formOptions.type === 'image') {
        if (!String(formOptions.watermarkFile || '').trim()) {
          onValidateError?.('请先选择本地水印图片')
          return
        }
      }

      if (output.mode === 'dir' && !String(output.dir || '').trim()) {
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
        progressMessage: '连接处理引擎...',
        error: null,
      }))

      streamProcessImage(
        {
          action,
          files: paths,
          options,
          output: {
            mode: output.mode,
            dir: output.mode === 'dir' ? output.dir : undefined,
            overwrite: !!output.overwrite,
          },
          common: {
            autoOrient: common.autoOrient,
            stripMetadata: common.stripMetadata,
          },
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
          onResult: (result) => {
            runningRef.current = false
            const lastOk = [...(result.items || [])]
              .reverse()
              .find((item) => item.ok && item.outputPath)

            setState((prev) => ({
              ...prev,
              status: 'success',
              progress: 100,
              progressMessage: '处理完成',
              result,
              error: null,
              lastOutputPath: lastOk?.outputPath || prev.lastOutputPath,
            }))
          },
          onError: (err) => {
            runningRef.current = false
            setState((prev) => ({
              ...prev,
              status: 'error',
              progress: 0,
              progressMessage: '',
              error: err.message || '处理失败',
            }))
          },
        },
      )
    },
    [],
  )

  return {
    ...state,
    process,
    resetResult,
    isRunning: state.status === 'running',
  }
}
