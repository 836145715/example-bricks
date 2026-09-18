/** 与 runtime/SDK 线协议对齐的最小类型（UI 侧自有，不依赖 vendor 类型）。 */

export type BrickOrigin = 'installed' | 'development' | 'review'

export interface BrickRef {
  brickId: string
  origin: BrickOrigin
  version: string
}

export interface DevBrickSummary {
  brickId: string
  name: string | Record<string, string>
  version: string
  origin: BrickOrigin
  valid: boolean
  loadState?: 'runnable' | 'not-built' | 'stale'
  flags: {
    hasUi: boolean
    hasCommands: boolean
    hasRuntime: boolean
    hasDependencies: boolean
  }
}

export interface DevBrickDetail extends DevBrickSummary {
  manifest: Record<string, unknown>
}

export interface TemplateOptions {
  runtimes: readonly string[]
  uiStacks: readonly string[]
  featurePresets: readonly string[]
  platforms: readonly string[]
  defaults: {
    runtime: string
    uiStack: string
    featurePreset: string
    version: string
    apiVersion: string
  }
}

export interface StarterConfigField {
  name: string
  label?: string
  type: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
  secret?: boolean
  default?: string
  env?: string
}

export interface StarterEnvVar {
  name: string
  description?: string
  default?: string
  required?: boolean
  secret?: boolean
}

export interface ToolDependency {
  alias: string
  brickId: string
  origin: string
  version: string
  note?: string
}

export interface StarterDraft {
  runtime: string
  uiStack: string
  featurePreset: string
  brickId: string
  name: string
  description?: string
  authorName: string
  version?: string
  apiVersion?: string
  keywords?: string[]
  configFields?: StarterConfigField[]
  envVars?: StarterEnvVar[]
  toolDependencies?: ToolDependency[]
}

export interface FilePreviewEntry {
  path: string
  kind: 'file' | 'dir'
  bytes?: number
}

export interface PreviewResult {
  manifest: Record<string, unknown>
  files: { path: string; content: string }[]
  fileTree: FilePreviewEntry[]
  warnings: string[]
}

export interface CreateResult {
  destDir: string
  createdFiles: string[]
  manifest: Record<string, unknown>
  warnings: string[]
  rescan: { bricks: DevBrickSummary[] }
}
