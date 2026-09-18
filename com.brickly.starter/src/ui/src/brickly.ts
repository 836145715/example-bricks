import type {
  BrickRef,
  CreateResult,
  DevBrickDetail,
  DevBrickSummary,
  PreviewResult,
  StarterDraft,
  TemplateOptions
} from './types'

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

export function listTemplates(): Promise<TemplateOptions> {
  return requireBrickly().invoke<TemplateOptions>('list-templates', {})
}

export function listBricks(): Promise<DevBrickSummary[]> {
  return requireBrickly().invoke<DevBrickSummary[]>('list-bricks', {})
}

export function getBrickDetail(ref: BrickRef): Promise<DevBrickDetail | null> {
  return requireBrickly().invoke<DevBrickDetail | null>('get-brick-detail', { ref })
}

export function previewStarter(draft: StarterDraft): Promise<PreviewResult> {
  return requireBrickly().invoke<PreviewResult>('preview', { draft })
}

export function createStarter(draft: StarterDraft): Promise<CreateResult> {
  return requireBrickly().invoke<CreateResult>('create', { draft })
}
