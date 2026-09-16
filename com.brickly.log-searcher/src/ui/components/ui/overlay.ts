export function preventNestedOverlayDismiss(event: {
  preventDefault: () => void
  target: EventTarget | null
}) {
  if (event.target instanceof Element && event.target.closest('[data-log-overlay]')) {
    event.preventDefault()
  }
}
