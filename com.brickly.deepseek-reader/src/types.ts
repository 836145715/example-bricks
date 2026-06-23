export interface AIBricksGlobal {
  invoke: (brickId: string, commandId: string, input: Record<string, unknown>) => Promise<unknown>
  fs?: {
    pickDirectory?: (options?: { defaultPath?: string }) => Promise<string | undefined>
  }
}

export interface BricklyGlobal {
  readonly brickId?: string
  readonly instanceId?: string
  invoke: (commandId: string, input: Record<string, unknown>) => Promise<unknown>
  fs?: {
    pickDirectory?: (options?: { defaultPath?: string }) => Promise<string | undefined>
  }
}

declare global {
  interface Window {
    AIBricks?: AIBricksGlobal
    brickly?: BricklyGlobal
  }
}

export interface SaveResult {
  title: string
  messageCount: number
  savedTo: string
  bytes: number
}
