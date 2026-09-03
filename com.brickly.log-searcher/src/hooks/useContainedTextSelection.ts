import { useEffect, type RefObject } from 'react'

function isInside(root: Node, node: Node | null): boolean {
  return !!node && (root === node || root.contains(node))
}

function pointIsBeforeRoot(node: Node, offset: number, rootRange: Range): boolean {
  const point = document.createRange()
  point.setStart(node, offset)
  point.collapse(true)
  return point.compareBoundaryPoints(Range.START_TO_START, rootRange) < 0
}

function clampSelectionToRoot(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
  if (!selection.anchorNode || !selection.focusNode) return

  const anchorInside = isInside(root, selection.anchorNode)
  const focusInside = isInside(root, selection.focusNode)
  if (anchorInside && focusInside) return
  if (!anchorInside && !focusInside) return

  const rootRange = document.createRange()
  rootRange.selectNodeContents(root)

  let anchorNode = selection.anchorNode
  let anchorOffset = selection.anchorOffset
  let focusNode = selection.focusNode
  let focusOffset = selection.focusOffset

  if (!anchorInside) {
    if (pointIsBeforeRoot(anchorNode, anchorOffset, rootRange)) {
      anchorNode = rootRange.startContainer
      anchorOffset = rootRange.startOffset
    } else {
      anchorNode = rootRange.endContainer
      anchorOffset = rootRange.endOffset
    }
  }

  if (!focusInside) {
    if (pointIsBeforeRoot(focusNode, focusOffset, rootRange)) {
      focusNode = rootRange.startContainer
      focusOffset = rootRange.startOffset
    } else {
      focusNode = rootRange.endContainer
      focusOffset = rootRange.endOffset
    }
  }

  selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
}

export function useContainedTextSelection(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let clamping = false

    const onSelectionChange = () => {
      if (clamping) return
      const root = rootRef.current
      if (!root) return
      clamping = true
      try {
        clampSelectionToRoot(root)
      } catch {
        // Range can be invalid while Virtuoso recycles rows.
      } finally {
        clamping = false
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      const root = rootRef.current
      if (!root) return
      event.preventDefault()
      const selection = window.getSelection()
      if (!selection) return
      const range = document.createRange()
      range.selectNodeContents(root)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('mouseup', onSelectionChange)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('mouseup', onSelectionChange)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [rootRef])
}
