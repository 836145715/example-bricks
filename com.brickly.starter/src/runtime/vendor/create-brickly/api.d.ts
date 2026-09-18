/**
 * vendor/create-brickly/api.js 的手工维护类型镜像。
 * 上游 dist 的 .d.ts 是目录树不便 vendor；此处只声明脚手架 Brick 用到的最小面。
 * 上游 api.ts 变更时同步更新（CI 冒烟测试会兜住漂移）。
 */

export type StarterRuntime = 'none' | 'node' | 'python' | 'go'
export type StarterUiStack = 'none' | 'h5' | 'react-vite-ts' | 'vue-vite-ts'
export type StarterFeaturePreset = 'minimal' | 'full' | 'window'
export type PlatformsMode = 'current' | 'all'
export type RuntimePlatformKey =
  | 'win-x64'
  | 'win-arm64'
  | 'mac-x64'
  | 'mac-arm64'
  | 'linux-x64'
  | 'linux-arm64'

export const STARTER_RUNTIMES: readonly StarterRuntime[]
export const STARTER_UI_STACKS: readonly StarterUiStack[]
export const STARTER_FEATURE_PRESETS: readonly StarterFeaturePreset[]
export const ALL_PLATFORMS: readonly RuntimePlatformKey[]

export interface StarterEnvVar {
  name: string
  description?: string
  default?: string
  required?: boolean
  secret?: boolean
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

export interface StarterToolDependency {
  alias: string
  brickId: string
  origin: string
  version: string
  note?: string
}

export interface CreateStarterDraft {
  runtime: StarterRuntime
  uiStack: StarterUiStack
  featurePreset: StarterFeaturePreset
  brickId: string
  name: string
  description?: string
  authorName: string
  version?: string
  apiVersion?: string
  keywords?: string[]
  configFields?: StarterConfigField[]
  envVars?: StarterEnvVar[]
  toolDependencies?: StarterToolDependency[]
}

export type GeneratedFile = { path: string; content: string }

export interface StarterFilePreview {
  path: string
  kind: 'file' | 'dir'
  bytes?: number
}

export interface StarterPreviewResult {
  manifest: unknown
  files: GeneratedFile[]
  fileTree: StarterFilePreview[]
  warnings: string[]
}

export interface StarterCreateResult {
  destDir: string
  createdFiles: string[]
  manifest: unknown
  warnings: string[]
}

export interface StarterOptions {
  platforms?: PlatformsMode
  schemaHref?: string
  manifestSchemaPath?: string
}

export declare function previewStarterFiles(
  options: { draft: CreateStarterDraft } & StarterOptions
): StarterPreviewResult

export declare function createStarterProject(
  options: { draft: CreateStarterDraft; destDir: string } & StarterOptions
): StarterCreateResult

export declare function resolvePlatforms(mode?: PlatformsMode): RuntimePlatformKey[]
