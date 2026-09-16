import { useCallback, useRef, useState } from 'react'
import { decodeQr, fileToDataUrl, getPathForFile, makeThumb } from '../lib/bridge'
import type { HistoryItem } from '../types'

type PushHistory = (partial: Omit<HistoryItem, 'id' | 'createdAt'>) => HistoryItem

export function useDecodeWorkspace(options: {
  push: PushHistory
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
  onHistorySelect: (id: string | null) => void
}) {
  const { push, onToast, onHistorySelect } = options
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [resultText, setResultText] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /** 防止过期异步结果写回 */
  const runIdRef = useRef(0)

  const restoreFromHistory = useCallback((item: HistoryItem) => {
    if (item.kind !== 'decode') return
    setPreviewUrl(item.previewThumb || null)
    if (item.status === 'ok') {
      setResultText(item.resultText || '')
      setErrorMessage(null)
    } else {
      setResultText(null)
      setErrorMessage(item.errorMessage || '解析失败')
    }
    setBusy(false)
  }, [])

  const clear = useCallback(() => {
    runIdRef.current += 1
    setBusy(false)
    setPreviewUrl(null)
    setResultText(null)
    setErrorMessage(null)
  }, [])

  const run = useCallback(
    async (file: File) => {
      const runId = ++runIdRef.current
      setBusy(true)
      setErrorMessage(null)
      setResultText(null)
      onHistorySelect(null)

      let dataUrl = ''
      try {
        dataUrl = await fileToDataUrl(file)
        if (runId !== runIdRef.current) return
        setPreviewUrl(dataUrl)
      } catch {
        if (runId !== runIdRef.current) return
        setBusy(false)
        setErrorMessage('读取图片失败')
        onToast('error', '读取图片失败')
        return
      }

      try {
        const absPath = getPathForFile(file)
        const result = absPath
          ? await decodeQr({ filePath: absPath })
          : await decodeQr({ imageBase64: dataUrl })

        if (runId !== runIdRef.current) return

        const thumb = await makeThumb(dataUrl)
        if (runId !== runIdRef.current) return

        if (result.ok && result.text != null) {
          setResultText(result.text)
          setErrorMessage(null)
          const item = push({
            kind: 'decode',
            status: 'ok',
            resultText: result.text,
            previewThumb: thumb,
          })
          onHistorySelect(item.id)
          onToast('ok', '解析成功')
        } else {
          const msg = result.error?.message || '解析失败'
          setErrorMessage(msg)
          const item = push({
            kind: 'decode',
            status: 'error',
            errorMessage: msg,
            previewThumb: thumb,
          })
          onHistorySelect(item.id)
          onToast('error', msg)
        }
      } catch (e) {
        if (runId !== runIdRef.current) return
        const msg = e instanceof Error ? e.message : String(e)
        setErrorMessage(msg)
        const thumb = await makeThumb(dataUrl)
        if (runId !== runIdRef.current) return
        push({
          kind: 'decode',
          status: 'error',
          errorMessage: msg,
          previewThumb: thumb,
        })
        onToast('error', msg)
      } finally {
        if (runId === runIdRef.current) setBusy(false)
      }
    },
    [push, onToast, onHistorySelect],
  )

  return {
    busy,
    previewUrl,
    resultText,
    errorMessage,
    run,
    restoreFromHistory,
    clear,
  }
}
