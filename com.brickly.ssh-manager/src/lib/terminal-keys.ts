export function isCopyKey(event: KeyboardEvent): boolean {
  if (event.altKey) return false
  if (event.code === 'Insert' && event.ctrlKey && !event.shiftKey && !event.metaKey) return true
  const mod = event.ctrlKey || event.metaKey
  return mod && event.code === 'KeyC'
}

export function isPasteKey(event: KeyboardEvent): boolean {
  if (event.altKey) return false
  if (event.code === 'Insert' && event.shiftKey && !event.ctrlKey && !event.metaKey) return true
  const mod = event.ctrlKey || event.metaKey
  return mod && event.code === 'KeyV'
}

export function containsCommandSubmit(data: string): boolean {
  return data.includes('\r') || data.includes('\n')
}

export function isUiField(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined') return false
  if (!(target instanceof HTMLElement)) return false
  if (target.classList.contains('xterm-helper-textarea')) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
