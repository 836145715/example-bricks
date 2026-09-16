/** window.brickly 的最小类型面（与 @syllm/brickly-ui 对齐，仅本目录所需子集）。 */
export interface BricklyRequestHandle<T = unknown> extends PromiseLike<T> {
  cancel(): void
  result(): Promise<T>
}

export interface BricklyInteraction<TEvent = unknown, TResult = unknown> {
  send(payload: unknown): Promise<void>
  sendLatest(key: string, payload: unknown): Promise<void>
  request(
    payload: unknown,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): BricklyRequestHandle<unknown>
  end(timeoutMs?: number): Promise<TResult>
  cancel(reason?: string): void
}

export interface BricklyStartedHandle {
  invoke<TResult = unknown>(commandId: string, input: Record<string, unknown>): Promise<TResult>
  interact<TEvent = unknown, TResult = unknown>(
    commandId: string,
    input: Record<string, unknown>,
    options: { onEvent: (event: TEvent) => unknown | Promise<unknown>; signal?: AbortSignal }
  ): Promise<BricklyInteraction<TEvent, TResult>>
  dispose(): Promise<void>
}

export interface Brickly {
  start(): Promise<BricklyStartedHandle>
}
