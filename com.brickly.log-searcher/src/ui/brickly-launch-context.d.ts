/**
 * launchContext / openUi 类型补丁。
 * 平台 preload 已注入这两个 API，但 @syllm/brickly-ui 已发布版本（≤0.12）
 * 类型里还没有；SDK 升级包含声明后可删除本文件。
 */
import type { BricklyRef } from '@syllm/brickly-ui'

declare module '@syllm/brickly-ui' {
  export type BricklyLaunchContextVia = 'dependency' | 'runtime' | 'quickSearch' | 'hotkey' | 'manual'

  export interface BricklyLaunchContext {
    entry?: string
    params?: unknown
    from: {
      ref?: BricklyRef
      via: BricklyLaunchContextVia
    }
  }

  export interface BricklyOpenUiOptions {
    entry?: string
    params?: unknown
    focus?: boolean
  }

  export interface BricklyDependencyClient {
    openUi(options?: BricklyOpenUiOptions): Promise<{ windowKey?: string }>
  }

  export interface Brickly {
    onLaunchContext(callback: (context: BricklyLaunchContext) => void): () => void
  }
}
