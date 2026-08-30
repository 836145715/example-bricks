export interface BricklyGlobal {
  readonly brickId?: string
  readonly instanceId?: string
  invoke: (commandId: string, input: Record<string, unknown>) => Promise<unknown>
  interact?: (commandId: string, input: Record<string, unknown>) => Promise<unknown>
  call?: (commandId: string, input: Record<string, unknown>) => Promise<unknown>
  start?: () => Promise<unknown>
  fs?: {
    pickDirectory?: (options?: { defaultPath?: string }) => Promise<string | undefined>
  }
}

declare global {
  interface Window {
    brickly?: BricklyGlobal
  }
}

export interface SaveResult {
  title: string
  messageCount: number
  savedTo: string
  bytes: number
}
