import { useCallback, useEffect, useRef, useState } from 'react'
import { generateQr, makeThumb } from '../lib/bridge'
import type { EcLevel, ModuleStyle } from '../components/GeneratePanel'
import {
  loadGeneratePrefs,
  normalizeStyle,
  saveGeneratePrefs,
} from '../lib/history'
import type { GenerateStyleSnapshot, HistoryItem } from '../types'

type PushHistory = (partial: Omit<HistoryItem, 'id' | 'createdAt'>) => HistoryItem

function toSnapshot(parts: {
  size: number
  margin: number
  errorCorrection: EcLevel
  moduleStyle: ModuleStyle
  darkColor: string
  lightColor: string
}): GenerateStyleSnapshot {
  return normalizeStyle(parts)
}

export function useGenerateWorkspace(options: {
  push: PushHistory
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
  onHistorySelect: (id: string | null) => void
}) {
  const { push, onToast, onHistorySelect } = options

  const initial = loadGeneratePrefs()
  const [text, setText] = useState('')
  const [size, setSize] = useState(initial.size)
  const [margin, setMargin] = useState(initial.margin)
  const [errorCorrection, setErrorCorrection] = useState<EcLevel>(initial.errorCorrection)
  const [moduleStyle, setModuleStyle] = useState<ModuleStyle>(initial.moduleStyle)
  const [darkColor, setDarkColor] = useState(initial.darkColor)
  const [lightColor, setLightColor] = useState(initial.lightColor)
  const [busy, setBusy] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const runIdRef = useRef(0)
  const styleRef = useRef(
    toSnapshot({ size, margin, errorCorrection, moduleStyle, darkColor, lightColor }),
  )
  styleRef.current = toSnapshot({
    size,
    margin,
    errorCorrection,
    moduleStyle,
    darkColor,
    lightColor,
  })

  // 记忆当前生成配置（颜色/样式/尺寸），切换 Tab、刷新后仍在
  useEffect(() => {
    saveGeneratePrefs(styleRef.current)
  }, [size, margin, errorCorrection, moduleStyle, darkColor, lightColor])

  const applyStyle = useCallback((style: GenerateStyleSnapshot) => {
    const s = normalizeStyle(style)
    setSize(s.size)
    setMargin(s.margin)
    setErrorCorrection(s.errorCorrection)
    setModuleStyle(s.moduleStyle)
    setDarkColor(s.darkColor)
    setLightColor(s.lightColor)
    styleRef.current = s
    return s
  }, [])

  const restoreFromHistory = useCallback(
    (item: HistoryItem) => {
      if (item.kind !== 'generate') return
      const src = item.sourceText || item.resultText || ''
      setText(src)
      runIdRef.current += 1
      const runId = runIdRef.current

      // 优先用历史记录里的样式，没有则用当前面板样式
      const style = item.generateStyle
        ? applyStyle(item.generateStyle)
        : styleRef.current

      if (item.status === 'ok' && src) {
        setErrorMessage(null)
        // 先显示缩略，再按记忆样式重生成完整图
        setDataUrl(item.qrDataUrl || null)
        setOutputPath(null)
        void generateQr({
          text: src,
          size: style.size,
          margin: style.margin,
          errorCorrection: style.errorCorrection,
          moduleStyle: style.moduleStyle,
          darkColor: style.darkColor,
          lightColor: style.lightColor,
          output: { mode: 'memory' },
        }).then((result) => {
          if (runId !== runIdRef.current) return
          if (result.ok && result.dataUrl) {
            setDataUrl(result.dataUrl)
            setOutputPath(result.outputPath || null)
          }
        })
      } else {
        setDataUrl(null)
        setOutputPath(null)
        setErrorMessage(item.errorMessage || '生成失败')
      }
      setBusy(false)
    },
    [applyStyle],
  )

  const run = useCallback(async () => {
    const value = text.trim()
    if (!value) {
      onToast('error', '请输入文本')
      return
    }

    const runId = ++runIdRef.current
    setBusy(true)
    setErrorMessage(null)
    onHistorySelect(null)

    const style = styleRef.current
    saveGeneratePrefs(style)

    try {
      const result = await generateQr({
        text: value,
        size: style.size,
        margin: style.margin,
        errorCorrection: style.errorCorrection,
        moduleStyle: style.moduleStyle,
        darkColor: style.darkColor,
        lightColor: style.lightColor,
        output: { mode: 'memory' },
      })

      if (runId !== runIdRef.current) return

      if (result.ok && result.dataUrl) {
        setDataUrl(result.dataUrl)
        setOutputPath(result.outputPath || null)
        setErrorMessage(null)
        const thumb = await makeThumb(result.dataUrl, 96)
        if (runId !== runIdRef.current) return
        const item = push({
          kind: 'generate',
          status: 'ok',
          sourceText: value,
          qrDataUrl: thumb || result.dataUrl,
          resultText: value,
          generateStyle: { ...style },
        })
        onHistorySelect(item.id)
        onToast('ok', '生成成功')
      } else {
        const msg = result.error?.message || '生成失败'
        setErrorMessage(msg)
        setDataUrl(null)
        push({
          kind: 'generate',
          status: 'error',
          sourceText: value,
          errorMessage: msg,
          generateStyle: { ...style },
        })
        onToast('error', msg)
      }
    } catch (e) {
      if (runId !== runIdRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMessage(msg)
      push({
        kind: 'generate',
        status: 'error',
        sourceText: value,
        errorMessage: msg,
        generateStyle: { ...styleRef.current },
      })
      onToast('error', msg)
    } finally {
      if (runId === runIdRef.current) setBusy(false)
    }
  }, [text, push, onToast, onHistorySelect])

  return {
    text,
    setText,
    size,
    setSize,
    margin,
    setMargin,
    errorCorrection,
    setErrorCorrection,
    moduleStyle,
    setModuleStyle,
    darkColor,
    setDarkColor,
    lightColor,
    setLightColor,
    busy,
    dataUrl,
    outputPath,
    errorMessage,
    run,
    restoreFromHistory,
  }
}
