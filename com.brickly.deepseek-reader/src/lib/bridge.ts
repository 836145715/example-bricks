const PLUGIN = 'com.brickly.deepseek-reader'

export async function invokePlugin<T = unknown>(
  commandId: string,
  input: Record<string, unknown>
): Promise<T> {
  if (window.brickly?.invoke) {
    return window.brickly.invoke(commandId, input) as Promise<T>
  }
  if (!window.AIBricks?.invoke) {
    throw new Error('window.brickly 不可用，请确认应用已在 Brickly 中打开')
  }
  return window.AIBricks.invoke(PLUGIN, commandId, input) as Promise<T>
}

export async function pickExportDirectory(): Promise<string | undefined> {
  if (window.brickly?.fs?.pickDirectory) {
    return window.brickly.fs.pickDirectory()
  }
  if (window.AIBricks?.fs?.pickDirectory) {
    return window.AIBricks.fs.pickDirectory()
  }
  throw new Error('未检测到宿主目录选择接口，请重新加载 Brickly 后打开此应用')
}
