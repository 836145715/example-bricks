import { Loader2, Play } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, execCommand } from '../brickly'
import type { ExecResult, Host } from '../types'

export function ExecPanel({ host }: { host: Host }) {
  const [command, setCommand] = useState('uname -a')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExecResult | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await execCommand({ hostId: host.id, command }))
    } catch (err) {
      setResult(null)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="exec-pane">
      <header>
        <h3>远程命令</h3>
        <p>{host.name || host.host}</p>
      </header>
      <div className="exec-col">
        <textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void run()
            }
          }}
          placeholder="uptime"
          rows={4}
        />
        <button type="button" className="primary-btn" disabled={busy || !command.trim()} onClick={() => void run()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          执行
        </button>
      </div>
      {error ? <pre className="exec-error">{error}</pre> : null}
      {result ? (
        <div className="exec-result">
          <p>退出码 {result.exitCode}</p>
          {result.stdout ? <pre>{result.stdout}</pre> : null}
          {result.stderr ? <pre className="exec-error">{result.stderr}</pre> : null}
        </div>
      ) : null}
    </section>
  )
}
