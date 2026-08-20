export function SftpCrumbs({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const crumbs = path.split('/').filter(Boolean)
  return (
    <ol className="sftp-crumbs">
      <li>
        <button type="button" onClick={() => onOpen('/')}>
          /
        </button>
      </li>
      {crumbs.map((part, index) => (
        <li key={`${part}-${index}`}>
          <button type="button" onClick={() => onOpen('/' + crumbs.slice(0, index + 1).join('/'))}>
            {part}
          </button>
        </li>
      ))}
    </ol>
  )
}

export function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return '/'
  return '/' + parts.slice(0, -1).join('/')
}
