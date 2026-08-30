export function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  const trimmed = highlight.trim()
  if (!trimmed) return <span>{text}</span>
  try {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return (
      <span>
        {parts.map((part, index) =>
          part.toLowerCase() === trimmed.toLowerCase() ? (
            <span key={index} className="search-highlight">
              {part}
            </span>
          ) : (
            part
          )
        )}
      </span>
    )
  } catch {
    return <span>{text}</span>
  }
}
