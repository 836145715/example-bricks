import clsx from 'clsx'

export function StatusBar({
  indexReady,
  notice,
  effectiveQuery
}: {
  indexReady: boolean
  notice: string
  effectiveQuery: string
}) {
  return (
    <footer className="statusbar">
      <span className={clsx('status-dot', indexReady ? 'status-ok' : 'status-warn')} />
      <span>{notice}</span>
      <code>{effectiveQuery}</code>
    </footer>
  )
}
