import type { ActionId, ToolGroup } from '../types'

export interface ToolMeta {
  id: ActionId
  label: string
  group: ToolGroup
  description: string
  defaultOptions: Record<string, unknown>
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'compress',
    label: '压缩',
    group: 'single',
    description: '按质量或目标大小压缩',
    defaultOptions: { quality: 80, targetSizeKb: '' },
  },
  {
    id: 'convert',
    label: '格式转换',
    group: 'single',
    description: '转换为 WebP / JPEG / PNG 等',
    defaultOptions: { format: 'webp', quality: 82, lossless: false },
  },
  {
    id: 'resize',
    label: '修改尺寸',
    group: 'single',
    description: '按宽高或比例缩放',
    defaultOptions: {
      width: '',
      height: '',
      keepRatio: true,
      scale: 100,
      fit: 'contain',
      bg: '#000000',
    },
  },
  {
    id: 'watermark',
    label: '水印',
    group: 'single',
    description: '文字或图片水印',
    defaultOptions: {
      type: 'text',
      text: '机密图片，禁止外传',
      fontSize: 28,
      color: '#ffffff',
      angle: -30,
      watermarkFile: '',
      watermarkScale: 20,
      opacity: 40,
      gravity: 'centre',
    },
  },
  {
    id: 'roundedCorners',
    label: '圆角',
    group: 'single',
    description: '圆角遮罩与背景填充',
    defaultOptions: { radius: 30, bgType: 'transparent', bg: '#ffffff' },
  },
  {
    id: 'padding',
    label: '补边',
    group: 'single',
    description: '四周留白扩展画布',
    defaultOptions: { top: 30, bottom: 30, left: 30, right: 30, bg: '#ffffff' },
  },
  {
    id: 'crop',
    label: '裁剪',
    group: 'single',
    description: '数值或拖拽裁剪区域',
    defaultOptions: {
      cropRatio: 'free',
      x: 50,
      y: 50,
      width: 400,
      height: 300,
    },
  },
  {
    id: 'rotate',
    label: '旋转',
    group: 'single',
    description: '按角度旋转图片',
    defaultOptions: { angle: 0, bg: '#000000' },
  },
  {
    id: 'flip',
    label: '翻转',
    group: 'single',
    description: '水平或垂直镜像',
    defaultOptions: { horizontal: false, vertical: false },
  },
  {
    id: 'stripMeta',
    label: '去元数据',
    group: 'single',
    description: '去除 EXIF 等元数据',
    defaultOptions: {},
  },
  {
    id: 'join',
    label: '拼接',
    group: 'multi',
    description: '多图拼接成长图',
    defaultOptions: { direction: 'vertical', gap: 0, bg: '#000000' },
  },
  {
    id: 'pdf',
    label: '合并 PDF',
    group: 'multi',
    description: '多图合并为多页 PDF',
    defaultOptions: {},
  },
  {
    id: 'gif',
    label: '合成 GIF',
    group: 'multi',
    description: '多图合成动画 GIF',
    defaultOptions: { delay: 200 },
  },
]

export const TOOL_MAP: Record<ActionId, ToolMeta> = TOOLS.reduce(
  (acc, tool) => {
    acc[tool.id] = tool
    return acc
  },
  {} as Record<ActionId, ToolMeta>,
)

export const SINGLE_TOOLS = TOOLS.filter((t) => t.group === 'single')
export const MULTI_TOOLS = TOOLS.filter((t) => t.group === 'multi')

export function isMultiAction(action: ActionId): boolean {
  return TOOL_MAP[action]?.group === 'multi'
}

export function getDefaultOptions(action: ActionId): Record<string, unknown> {
  return { ...TOOL_MAP[action].defaultOptions }
}

/**
 * Normalize form state into the payload expected by runtime actions.
 * Crop always submits as action crop with x/y/width/height.
 */
export function buildActionOptions(
  action: ActionId,
  form: Record<string, unknown>,
  cropRect?: { x: number; y: number; width: number; height: number },
  cropMode?: 'numeric' | 'drag',
): Record<string, unknown> {
  switch (action) {
    case 'compress': {
      const out: Record<string, unknown> = {
        quality: Number(form.quality ?? 80),
      }
      const target = String(form.targetSizeKb ?? '').trim()
      if (target) out.targetSizeKb = Number(target)
      return out
    }
    case 'convert':
      return {
        format: form.format || 'webp',
        quality: Number(form.quality ?? 82),
        lossless: !!form.lossless,
      }
    case 'resize': {
      const out: Record<string, unknown> = {
        keepRatio: form.keepRatio !== false,
        scale: Number(form.scale ?? 100),
        fit: form.fit || 'contain',
        bg: form.bg || '#000000',
      }
      const w = String(form.width ?? '').trim()
      const h = String(form.height ?? '').trim()
      if (w) out.width = Number(w)
      if (h) out.height = Number(h)
      return out
    }
    case 'watermark': {
      const type = (form.type as string) || 'text'
      const out: Record<string, unknown> = {
        type,
        opacity: Number(form.opacity ?? 40) / 100,
        gravity: form.gravity || 'centre',
      }
      if (type === 'text') {
        out.text = form.text || 'Watermark'
        out.fontSize = Number(form.fontSize ?? 28)
        out.color = form.color || '#ffffff'
        out.angle = Number(form.angle ?? 0)
      } else {
        out.watermarkFile = form.watermarkFile || ''
        out.watermarkScale = Number(form.watermarkScale ?? 20)
      }
      return out
    }
    case 'roundedCorners': {
      const bgType = form.bgType || 'transparent'
      return {
        radius: Number(form.radius ?? 30),
        bg: bgType === 'solid' ? form.bg || '#ffffff' : '#00000000',
      }
    }
    case 'padding':
      return {
        top: Number(form.top ?? 0),
        bottom: Number(form.bottom ?? 0),
        left: Number(form.left ?? 0),
        right: Number(form.right ?? 0),
        bg: form.bg || '#ffffff',
      }
    case 'crop': {
      if (cropMode === 'drag' && cropRect) {
        return {
          x: cropRect.x,
          y: cropRect.y,
          width: cropRect.width,
          height: cropRect.height,
        }
      }
      return {
        x: Number(form.x ?? 0),
        y: Number(form.y ?? 0),
        width: Number(form.width ?? 200),
        height: Number(form.height ?? 200),
      }
    }
    case 'rotate':
      return {
        angle: Number(form.angle ?? 0),
        bg: form.bg || '#000000',
      }
    case 'flip':
      return {
        horizontal: !!form.horizontal,
        vertical: !!form.vertical,
      }
    case 'stripMeta':
      return {}
    case 'join':
      return {
        direction: form.direction || 'vertical',
        gap: Number(form.gap ?? 0),
        bg: form.bg || '#000000',
      }
    case 'pdf':
      return {}
    case 'gif':
      return {
        delay: Number(form.delay ?? 200),
      }
    default:
      return { ...form }
  }
}
