import type { ReactNode } from 'react'
import { ExternalLink, LocateFixed } from 'lucide-react'

export function PreviewState({
  icon,
  title,
  description,
  onOpen,
  onShowInFolder
}: {
  icon: ReactNode
  title: string
  description: string
  onOpen?: () => void
  onShowInFolder?: () => void
}) {
  return (
    <div className="preview-state">
      {icon}
      <h2>{title}</h2>
      <p>{description}</p>
      {onOpen || onShowInFolder ? (
        <div className="preview-state-actions">
          {onOpen ? (
            <button onClick={onOpen} type="button">
              <ExternalLink size={14} />
              打开
            </button>
          ) : null}
          {onShowInFolder ? (
            <button onClick={onShowInFolder} type="button">
              <LocateFixed size={14} />
              定位
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
