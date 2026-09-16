export type DirectoryPicker = (options?: {
  defaultPath?: string
}) => Promise<string | undefined>

/** 打开宿主目录选择器；用户取消时保留当前共享目录。 */
export async function selectShareDirectory(
  currentRoot: string,
  pickDirectory: DirectoryPicker
): Promise<string> {
  const selectedRoot = await pickDirectory({ defaultPath: currentRoot })
  return selectedRoot?.trim() ? selectedRoot : currentRoot
}
