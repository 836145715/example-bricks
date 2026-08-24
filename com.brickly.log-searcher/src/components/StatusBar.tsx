interface StatusBarProps {
  message: string
  dot: 'active' | 'warn' | 'error' | ''
}

export function StatusBar({ message, dot }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="status-left">
        <div className={`status-dot ${dot}`} />
        <span>{message}</span>
      </div>
      <div>Go Runtime</div>
    </footer>
  )
}
