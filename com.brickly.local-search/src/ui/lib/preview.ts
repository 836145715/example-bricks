export function pdfPreviewUrl(fileUrl?: string) {
  if (!fileUrl) return undefined
  const separator = fileUrl.includes('#') ? '&' : '#'
  return `${fileUrl}${separator}pagemode=none&navpanes=0`
}

export function base64ToUint8Array(value: string) {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
