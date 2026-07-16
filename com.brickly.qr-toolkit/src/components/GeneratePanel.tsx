import {
  Copy,
  DownloadSimple,
  FolderOpen,
  SpinnerGap,
} from '@phosphor-icons/react'
import { copyImageDataUrl, downloadDataUrl, openFolder } from '../lib/bridge'

export type EcLevel = 'L' | 'M' | 'Q' | 'H'
export type ModuleStyle = 'square' | 'rounded' | 'dots'

export interface ColorPreset {
  id: string
  label: string
  dark: string
  light: string
}

export const COLOR_PRESETS: ColorPreset[] = [
  { id: 'classic', label: '经典', dark: '#000000', light: '#ffffff' },
  { id: 'emerald', label: '翠绿', dark: '#0d9488', light: '#ecfdf5' },
  { id: 'slate', label: '石板', dark: '#1e293b', light: '#f1f5f9' },
  { id: 'indigo', label: '靛蓝', dark: '#3730a3', light: '#eef2ff' },
  { id: 'rose', label: '玫红', dark: '#be123c', light: '#fff1f2' },
  { id: 'invert', label: '反色', dark: '#ffffff', light: '#0f172a' },
  { id: 'amber', label: '琥珀', dark: '#b45309', light: '#fffbeb' },
  { id: 'ghost', label: '透明底', dark: '#111827', light: '#00000000' },
]

const MODULE_STYLE_OPTS: { value: ModuleStyle; label: string; hint: string }[] = [
  { value: 'square', label: '方块', hint: '标准，识别率最高' },
  { value: 'rounded', label: '圆角', hint: '定位点仍为方块' },
  { value: 'dots', label: '圆点', hint: '定位点仍为方块' },
]

interface GeneratePanelProps {
  text: string
  size: number
  margin: number
  errorCorrection: EcLevel
  moduleStyle: ModuleStyle
  darkColor: string
  lightColor: string
  busy: boolean
  dataUrl: string | null
  outputPath: string | null
  errorMessage: string | null
  onTextChange: (v: string) => void
  onSizeChange: (v: number) => void
  onMarginChange: (v: number) => void
  onEcChange: (v: EcLevel) => void
  onModuleStyleChange: (v: ModuleStyle) => void
  onDarkColorChange: (v: string) => void
  onLightColorChange: (v: string) => void
  onGenerate: () => void
  onToast: (kind: 'ok' | 'error' | 'info', text: string) => void
}

function colorInputValue(hex: string): string {
  // <input type="color"> needs #rrggbb
  const s = hex.replace('#', '')
  if (s.length >= 6) return `#${s.slice(0, 6)}`
  return '#000000'
}

export function GeneratePanel({
  text,
  size,
  margin,
  errorCorrection,
  moduleStyle,
  darkColor,
  lightColor,
  busy,
  dataUrl,
  outputPath,
  errorMessage,
  onTextChange,
  onSizeChange,
  onMarginChange,
  onEcChange,
  onModuleStyleChange,
  onDarkColorChange,
  onLightColorChange,
  onGenerate,
  onToast,
}: GeneratePanelProps) {
  const activePreset = COLOR_PRESETS.find(
    (p) =>
      p.dark.toLowerCase() === darkColor.toLowerCase() &&
      p.light.toLowerCase() === lightColor.toLowerCase(),
  )

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_280px]">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
        <label className="flex min-h-[120px] flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--fg-muted)]">文本内容</span>
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="输入要编码的链接或文本"
            className="min-h-[120px] flex-1 resize-y rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-sunken)] px-3 py-2.5 font-mono text-[12.5px] text-[var(--fg)] outline-none transition placeholder:text-[var(--fg-dim)] focus:border-[var(--ac-line)]"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--fg-dim)]">尺寸 (px)</span>
            <input
              type="number"
              min={64}
              max={2048}
              step={16}
              value={size}
              onChange={(e) => onSizeChange(Number(e.target.value) || 256)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2 font-mono text-[12.5px] outline-none focus:border-[var(--ac-line)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--fg-dim)]">边距</span>
            <input
              type="number"
              min={0}
              max={16}
              value={margin}
              onChange={(e) => onMarginChange(Number(e.target.value) || 0)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2 font-mono text-[12.5px] outline-none focus:border-[var(--ac-line)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--fg-dim)]">纠错</span>
            <select
              value={errorCorrection}
              onChange={(e) => onEcChange(e.target.value as EcLevel)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2 text-[12.5px] outline-none focus:border-[var(--ac-line)]"
            >
              <option value="L">L 低</option>
              <option value="M">M 中</option>
              <option value="Q">Q 较高</option>
              <option value="H">H 高</option>
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--fg-muted)]">模块样式</span>
          <div className="grid grid-cols-3 gap-1.5">
            {MODULE_STYLE_OPTS.map((opt) => {
              const active = moduleStyle === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.hint}
                  onClick={() => onModuleStyleChange(opt.value)}
                  className={`flex h-11 flex-col items-center justify-center rounded-[var(--radius-sm)] border text-[12px] font-medium transition ${
                    active
                      ? 'border-[var(--ac-line)] bg-[var(--ac-soft)] text-[var(--ac)]'
                      : 'border-[var(--line)] bg-[var(--bg-2)] text-[var(--fg-muted)] hover:border-[var(--line-strong)]'
                  }`}
                >
                  {opt.label}
                  <span className="mt-0.5 text-[10px] font-normal text-[var(--fg-dim)]">
                    {opt.value === 'square' ? '■' : opt.value === 'rounded' ? '▪' : '●'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--fg-muted)]">颜色预设</span>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((p) => {
              const active = activePreset?.id === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onDarkColorChange(p.dark)
                    onLightColorChange(p.light)
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition ${
                    active
                      ? 'border-[var(--ac-line)] bg-[var(--ac-soft)] text-[var(--fg)]'
                      : 'border-[var(--line)] bg-[var(--bg-2)] text-[var(--fg-muted)] hover:border-[var(--line-strong)]'
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-black/20"
                    style={{
                      background:
                        p.light.endsWith('00') || p.light.length === 9
                          ? `linear-gradient(135deg, ${p.dark} 50%, transparent 50%), repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 0 0 / 6px 6px`
                          : p.dark,
                      boxShadow: p.light.endsWith('00') ? undefined : `inset 0 0 0 2px ${p.light}`,
                    }}
                  />
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--fg-dim)]">前景色</span>
            <div className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2">
              <input
                type="color"
                value={colorInputValue(darkColor)}
                onChange={(e) => onDarkColorChange(e.target.value)}
                className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
              />
              <input
                type="text"
                value={darkColor}
                onChange={(e) => onDarkColorChange(e.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] outline-none"
                spellCheck={false}
              />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--fg-dim)]">背景色</span>
            <div className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2">
              <input
                type="color"
                value={colorInputValue(lightColor)}
                onChange={(e) => onLightColorChange(e.target.value + (lightColor.length === 9 ? lightColor.slice(7) : ''))}
                className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
              />
              <input
                type="text"
                value={lightColor}
                onChange={(e) => onLightColorChange(e.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] outline-none"
                spellCheck={false}
                placeholder="#ffffff 或 #rrggbbaa"
              />
            </div>
          </label>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={onGenerate}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--ac)] px-5 text-[13px] font-semibold text-[var(--ac-fg)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? <SpinnerGap size={16} className="animate-spin" /> : null}
            生成
          </button>
          {errorMessage && (
            <span className="text-[12px] text-[var(--danger)]">{errorMessage}</span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <span className="text-[12px] font-medium text-[var(--fg-muted)]">预览</span>
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-[var(--line)] p-4"
          style={{
            background:
              'repeating-conic-gradient(oklch(0.22 0.01 260) 0% 25%, oklch(0.18 0.01 260) 0% 50%) 0 0 / 12px 12px',
          }}
        >
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="二维码"
              className="max-h-[240px] max-w-full rounded shadow-md shadow-black/25"
            />
          ) : (
            <p className="text-[12.5px] text-[var(--fg-dim)]">生成后在此预览</p>
          )}
        </div>
        {dataUrl && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2.5 text-[11.5px] text-[var(--fg-muted)] hover:border-[var(--ac-line)] hover:text-[var(--fg)]"
              onClick={() => {
                downloadDataUrl(dataUrl, `qr-${Date.now()}.png`)
                onToast('ok', '已开始下载')
              }}
            >
              <DownloadSimple size={14} />
              下载 PNG
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2.5 text-[11.5px] text-[var(--fg-muted)] hover:border-[var(--ac-line)] hover:text-[var(--fg)]"
              onClick={async () => {
                const ok = await copyImageDataUrl(dataUrl)
                onToast(
                  ok ? 'ok' : 'error',
                  ok ? '图片已复制到剪贴板' : '复制图片失败，请改用下载 PNG',
                )
              }}
            >
              <Copy size={14} />
              复制图片
            </button>
            {outputPath && (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-2)] px-2.5 text-[11.5px] text-[var(--fg-muted)] hover:border-[var(--ac-line)] hover:text-[var(--fg)]"
                onClick={async () => {
                  const r = await openFolder(outputPath)
                  if (!r.ok) onToast('error', r.error || '打开目录失败')
                }}
              >
                <FolderOpen size={14} />
                打开目录
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
