import { useRef } from 'react'
import { Image as ImageIcon } from '@phosphor-icons/react'
import { TOOL_MAP } from '../config/tools'
import { getPathForFile } from '../lib/bridge'
import { percentFromRange } from '../lib/format'
import type { ActionId, CropMode, CropRect } from '../types'

interface OptionsPanelProps {
  action: ActionId
  options: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  cropMode: CropMode
  onCropModeChange: (mode: CropMode) => void
  cropRect: CropRect
}

function Field({
  label,
  children,
  tip,
}: {
  label: string
  children: React.ReactNode
  tip?: string
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11.5px] font-medium text-[var(--fg-dim)]">
        {label}
      </span>
      {children}
      {tip ? (
        <span className="mt-1 block text-[11px] leading-snug text-[var(--fg-dim)]">
          {tip}
        </span>
      ) : null}
    </label>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 grid grid-cols-2 gap-2">{children}</div>
}

const inputClass =
  'h-8 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-sunken)] px-2.5 text-[12.5px] text-[var(--fg)] outline-none transition focus:border-[var(--ac-line)]'
const selectClass = inputClass
const checkClass =
  'flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--fg-muted)]'

function Slider({
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  display: string
  onChange: (v: number) => void
}) {
  const pct = percentFromRange(value, min, max)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span className="text-[var(--fg-dim)]"> </span>
        <span className="font-mono text-[var(--fg-muted)]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        style={{ ['--val' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function OptionsPanel({
  action,
  options,
  onChange,
  cropMode,
  onCropModeChange,
  cropRect,
}: OptionsPanelProps) {
  const wmInputRef = useRef<HTMLInputElement>(null)
  const meta = TOOL_MAP[action]
  const set = (key: string, value: unknown) => onChange({ ...options, [key]: value })

  return (
    <section className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-1)]">
      <header className="border-b border-[var(--line)] px-3 py-2.5">
        <h2 className="text-[13px] font-semibold text-[var(--fg)]">{meta.label}</h2>
        <p className="mt-0.5 text-[11.5px] text-[var(--fg-dim)]">{meta.description}</p>
      </header>
      <div className="scroll-y flex-1 px-3 py-3">
        {action === 'compress' && (
          <>
            <Field label="压缩质量">
              <Slider
                value={Number(options.quality ?? 80)}
                min={1}
                max={100}
                display={`${options.quality ?? 80}%`}
                onChange={(v) => set('quality', v)}
              />
            </Field>
            <Field label="目标文件大小 (可选)" tip="填写后通过二分逼近目标大小 (KB)">
              <div className="relative">
                <input
                  type="number"
                  className={`${inputClass} pr-10`}
                  placeholder="不限"
                  value={String(options.targetSizeKb ?? '')}
                  onChange={(e) => set('targetSizeKb', e.target.value)}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--fg-dim)]">
                  KB
                </span>
              </div>
            </Field>
          </>
        )}

        {action === 'convert' && (
          <>
            <Field label="目标格式">
              <select
                className={selectClass}
                value={String(options.format ?? 'webp')}
                onChange={(e) => set('format', e.target.value)}
              >
                <option value="webp">WebP</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="avif">AVIF</option>
                <option value="gif">GIF</option>
              </select>
            </Field>
            <Field label="压缩质量">
              <Slider
                value={Number(options.quality ?? 82)}
                min={1}
                max={100}
                display={`${options.quality ?? 82}%`}
                onChange={(v) => set('quality', v)}
              />
            </Field>
            <label className={checkClass}>
              <input
                type="checkbox"
                checked={!!options.lossless}
                onChange={(e) => set('lossless', e.target.checked)}
                className="accent-[var(--ac)]"
              />
              无损转换 (WebP / AVIF)
            </label>
          </>
        )}

        {action === 'resize' && (
          <>
            <Row>
              <Field label="宽度 (px)">
                <input
                  type="number"
                  className={inputClass}
                  placeholder="等比"
                  value={String(options.width ?? '')}
                  onChange={(e) => set('width', e.target.value)}
                />
              </Field>
              <Field label="高度 (px)">
                <input
                  type="number"
                  className={inputClass}
                  placeholder="等比"
                  value={String(options.height ?? '')}
                  onChange={(e) => set('height', e.target.value)}
                />
              </Field>
            </Row>
            <label className={`${checkClass} mb-3`}>
              <input
                type="checkbox"
                checked={options.keepRatio !== false}
                onChange={(e) => set('keepRatio', e.target.checked)}
                className="accent-[var(--ac)]"
              />
              保持宽高比
            </label>
            <Field label="缩放比例" tip="设置缩放后宽高数值将失效">
              <Slider
                value={Number(options.scale ?? 100)}
                min={10}
                max={400}
                display={`${options.scale ?? 100}%`}
                onChange={(v) => set('scale', v)}
              />
            </Field>
            <Field label="裁剪模式">
              <select
                className={selectClass}
                value={String(options.fit ?? 'contain')}
                onChange={(e) => set('fit', e.target.value)}
              >
                <option value="contain">等比适应 (Contain)</option>
                <option value="cover">等比铺满 (Cover)</option>
                <option value="fill">强制拉伸 (Fill)</option>
              </select>
            </Field>
            <Field label="留白填充色">
              <input
                type="color"
                className={`${inputClass} h-9 cursor-pointer p-1`}
                value={String(options.bg ?? '#000000')}
                onChange={(e) => set('bg', e.target.value)}
              />
            </Field>
          </>
        )}

        {action === 'watermark' && (
          <>
            <Field label="水印类型">
              <select
                className={selectClass}
                value={String(options.type ?? 'text')}
                onChange={(e) => set('type', e.target.value)}
              >
                <option value="text">文字水印</option>
                <option value="image">图片水印</option>
              </select>
            </Field>
            {(options.type ?? 'text') === 'text' ? (
              <>
                <Field label="水印文字">
                  <input
                    type="text"
                    className={inputClass}
                    value={String(options.text ?? '')}
                    onChange={(e) => set('text', e.target.value)}
                  />
                </Field>
                <Row>
                  <Field label="字号 (px)">
                    <input
                      type="number"
                      className={inputClass}
                      value={Number(options.fontSize ?? 28)}
                      onChange={(e) => set('fontSize', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="颜色">
                    <input
                      type="color"
                      className={`${inputClass} h-9 cursor-pointer p-1`}
                      value={String(options.color ?? '#ffffff')}
                      onChange={(e) => set('color', e.target.value)}
                    />
                  </Field>
                </Row>
                <Field label="旋转角度">
                  <Slider
                    value={Number(options.angle ?? -30)}
                    min={-180}
                    max={180}
                    display={`${options.angle ?? -30}°`}
                    onChange={(v) => set('angle', v)}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="水印图片">
                  <input
                    ref={wmInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const path = getPathForFile(file)
                      set('watermarkFile', path || file.name)
                      e.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    className={`${inputClass} flex items-center gap-2 text-left`}
                    onClick={() => wmInputRef.current?.click()}
                  >
                    <ImageIcon size={14} />
                    <span className="truncate">
                      {options.watermarkFile
                        ? String(options.watermarkFile).split(/[/\\]/).pop()
                        : '选择水印图片...'}
                    </span>
                  </button>
                </Field>
                <Field label="占背景宽比例">
                  <Slider
                    value={Number(options.watermarkScale ?? 20)}
                    min={5}
                    max={80}
                    display={`${options.watermarkScale ?? 20}%`}
                    onChange={(v) => set('watermarkScale', v)}
                  />
                </Field>
              </>
            )}
            <Field label="透明度">
              <Slider
                value={Number(options.opacity ?? 40)}
                min={5}
                max={100}
                display={(Number(options.opacity ?? 40) / 100).toFixed(2)}
                onChange={(v) => set('opacity', v)}
              />
            </Field>
            <Field label="九宫格位置">
              <select
                className={selectClass}
                value={String(options.gravity ?? 'centre')}
                onChange={(e) => set('gravity', e.target.value)}
              >
                <option value="centre">居中</option>
                <option value="southeast">右下</option>
                <option value="southwest">左下</option>
                <option value="northeast">右上</option>
                <option value="northwest">左上</option>
                <option value="north">顶部居中</option>
                <option value="south">底部居中</option>
              </select>
            </Field>
          </>
        )}

        {action === 'roundedCorners' && (
          <>
            <Field label="圆角半径">
              <Slider
                value={Number(options.radius ?? 30)}
                min={1}
                max={500}
                display={`${options.radius ?? 30}px`}
                onChange={(v) => set('radius', v)}
              />
            </Field>
            <Field label="背景填充">
              <select
                className={selectClass}
                value={String(options.bgType ?? 'transparent')}
                onChange={(e) => set('bgType', e.target.value)}
              >
                <option value="transparent">透明 (建议 PNG/WebP)</option>
                <option value="solid">纯色填充</option>
              </select>
            </Field>
            {options.bgType === 'solid' && (
              <Field label="填充颜色">
                <input
                  type="color"
                  className={`${inputClass} h-9 cursor-pointer p-1`}
                  value={String(options.bg ?? '#ffffff')}
                  onChange={(e) => set('bg', e.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {action === 'padding' && (
          <>
            <Row>
              <Field label="上 (px)">
                <input
                  type="number"
                  className={inputClass}
                  value={Number(options.top ?? 30)}
                  onChange={(e) => set('top', Number(e.target.value))}
                />
              </Field>
              <Field label="下 (px)">
                <input
                  type="number"
                  className={inputClass}
                  value={Number(options.bottom ?? 30)}
                  onChange={(e) => set('bottom', Number(e.target.value))}
                />
              </Field>
            </Row>
            <Row>
              <Field label="左 (px)">
                <input
                  type="number"
                  className={inputClass}
                  value={Number(options.left ?? 30)}
                  onChange={(e) => set('left', Number(e.target.value))}
                />
              </Field>
              <Field label="右 (px)">
                <input
                  type="number"
                  className={inputClass}
                  value={Number(options.right ?? 30)}
                  onChange={(e) => set('right', Number(e.target.value))}
                />
              </Field>
            </Row>
            <Field label="留白颜色">
              <input
                type="color"
                className={`${inputClass} h-9 cursor-pointer p-1`}
                value={String(options.bg ?? '#ffffff')}
                onChange={(e) => set('bg', e.target.value)}
              />
            </Field>
          </>
        )}

        {action === 'crop' && (
          <>
            <div className="mb-3 flex rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-sunken)] p-0.5">
              {(
                [
                  { id: 'numeric', label: '数值' },
                  { id: 'drag', label: '拖拽' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onCropModeChange(m.id)}
                  className={`flex-1 rounded-[6px] py-1.5 text-[12px] font-medium transition ${
                    cropMode === m.id
                      ? 'bg-[var(--bg-2)] text-[var(--ac)] shadow-sm'
                      : 'text-[var(--fg-dim)] hover:text-[var(--fg-muted)]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {cropMode === 'numeric' ? (
              <>
                <Field label="快捷比例">
                  <select
                    className={selectClass}
                    value={String(options.cropRatio ?? 'free')}
                    onChange={(e) => {
                      const ratio = e.target.value
                      const next = { ...options, cropRatio: ratio }
                      if (ratio === '1:1') {
                        next.width = 400
                        next.height = 400
                      } else if (ratio === '4:3') {
                        next.width = 400
                        next.height = 300
                      } else if (ratio === '16:9') {
                        next.width = 480
                        next.height = 270
                      }
                      onChange(next)
                    }}
                  >
                    <option value="free">自由裁剪</option>
                    <option value="1:1">正方形 1:1</option>
                    <option value="4:3">标准 4:3</option>
                    <option value="16:9">宽银幕 16:9</option>
                  </select>
                </Field>
                <Row>
                  <Field label="起点 X">
                    <input
                      type="number"
                      className={inputClass}
                      value={Number(options.x ?? 0)}
                      onChange={(e) => set('x', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="起点 Y">
                    <input
                      type="number"
                      className={inputClass}
                      value={Number(options.y ?? 0)}
                      onChange={(e) => set('y', Number(e.target.value))}
                    />
                  </Field>
                </Row>
                <Row>
                  <Field label="宽度">
                    <input
                      type="number"
                      className={inputClass}
                      value={Number(options.width ?? 400)}
                      onChange={(e) => set('width', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="高度">
                    <input
                      type="number"
                      className={inputClass}
                      value={Number(options.height ?? 300)}
                      onChange={(e) => set('height', Number(e.target.value))}
                    />
                  </Field>
                </Row>
              </>
            ) : (
              <>
                <p className="mb-3 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                  在右侧预览图上拖动和缩放裁剪框。坐标会实时同步。
                </p>
                <Row>
                  <Field label="起点 X">
                    <input type="number" className={inputClass} value={cropRect.x} disabled />
                  </Field>
                  <Field label="起点 Y">
                    <input type="number" className={inputClass} value={cropRect.y} disabled />
                  </Field>
                </Row>
                <Row>
                  <Field label="宽度">
                    <input type="number" className={inputClass} value={cropRect.width} disabled />
                  </Field>
                  <Field label="高度">
                    <input type="number" className={inputClass} value={cropRect.height} disabled />
                  </Field>
                </Row>
              </>
            )}
          </>
        )}

        {action === 'rotate' && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`${inputClass} font-semibold`}
                onClick={() => set('angle', 90)}
              >
                顺时针 90°
              </button>
              <button
                type="button"
                className={`${inputClass} font-semibold`}
                onClick={() => set('angle', 180)}
              >
                旋转 180°
              </button>
            </div>
            <Field label="自定义角度">
              <Slider
                value={Number(options.angle ?? 0)}
                min={-360}
                max={360}
                display={`${options.angle ?? 0}°`}
                onChange={(v) => set('angle', v)}
              />
            </Field>
            <Field label="空白区填充" tip="旋转产生空隙时的填充色">
              <input
                type="color"
                className={`${inputClass} h-9 cursor-pointer p-1`}
                value={String(options.bg ?? '#000000')}
                onChange={(e) => set('bg', e.target.value)}
              />
            </Field>
          </>
        )}

        {action === 'flip' && (
          <>
            <label className={`${checkClass} mb-3`}>
              <input
                type="checkbox"
                checked={!!options.horizontal}
                onChange={(e) => set('horizontal', e.target.checked)}
                className="accent-[var(--ac)]"
              />
              水平镜像 (Flop)
            </label>
            <label className={checkClass}>
              <input
                type="checkbox"
                checked={!!options.vertical}
                onChange={(e) => set('vertical', e.target.checked)}
                className="accent-[var(--ac)]"
              />
              垂直镜像 (Flip)
            </label>
          </>
        )}

        {action === 'stripMeta' && (
          <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            将重新导出图片并去除 EXIF 等元数据。无需额外参数。
          </p>
        )}

        {action === 'join' && (
          <>
            <Field label="拼接方向">
              <select
                className={selectClass}
                value={String(options.direction ?? 'vertical')}
                onChange={(e) => set('direction', e.target.value)}
              >
                <option value="vertical">垂直长图</option>
                <option value="horizontal">水平横向</option>
              </select>
            </Field>
            <Field label="图片间隔">
              <Slider
                value={Number(options.gap ?? 0)}
                min={0}
                max={200}
                display={`${options.gap ?? 0}px`}
                onChange={(v) => set('gap', v)}
              />
            </Field>
            <Field label="间距填充色">
              <input
                type="color"
                className={`${inputClass} h-9 cursor-pointer p-1`}
                value={String(options.bg ?? '#000000')}
                onChange={(e) => set('bg', e.target.value)}
              />
            </Field>
          </>
        )}

        {action === 'pdf' && (
          <p className="text-[12.5px] leading-relaxed text-[var(--fg-muted)]">
            将选中的多张图片按顺序合并为多页 PDF。页面尺寸自动适应图片。
          </p>
        )}

        {action === 'gif' && (
          <Field label="帧间隔" tip="每一帧之间的切换延迟">
            <Slider
              value={Number(options.delay ?? 200)}
              min={50}
              max={2000}
              step={50}
              display={`${options.delay ?? 200}ms`}
              onChange={(v) => set('delay', v)}
            />
          </Field>
        )}
      </div>
    </section>
  )
}
