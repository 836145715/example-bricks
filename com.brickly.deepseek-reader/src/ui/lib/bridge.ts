export async function invokePlugin<T = unknown>(
  commandId: string,
  input: Record<string, unknown>
): Promise<T> {
  if (!window.brickly?.invoke) {
    throw new Error('window.brickly 不可用，请确认应用已在 Brickly 中打开')
  }
  return window.brickly.invoke(commandId, input) as Promise<T>
}

export async function pickExportDirectory(): Promise<string | undefined> {
  if (!window.brickly?.fs?.pickDirectory) {
    throw new Error('未检测到宿主目录选择接口，请重新加载 Brickly 后打开此应用')
  }
  return window.brickly.fs.pickDirectory()
}
