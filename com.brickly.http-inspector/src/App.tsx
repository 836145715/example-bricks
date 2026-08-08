import { useState } from 'react'
import { CircleStop, Copy, Download, Play, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { useHttpInspector } from './hooks/useHttpInspector'
import type { Message } from './types'

function MessageView({ title, message }: { title: string; message?: Message }) {
  const [tab, setTab] = useState<'headers' | 'body'>('headers')
  return <section className="message-pane">
    <header><strong>{title}</strong><nav><button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>Headers</button><button className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>Body</button></nav></header>
    {tab === 'headers' ? <dl>{Object.entries(message?.headers ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <pre>{message?.body || '(empty)'}{message?.truncated ? '\n\n[preview truncated]' : ''}</pre>}
  </section>
}

export default function App() {
  const vm = useHttpInspector()
  const [detailTab, setDetailTab] = useState<'overview' | 'request' | 'response'>('overview')
  const copyCurl = async () => {
    if (!vm.detail || !window.httpInspector) return
    const result = await window.httpInspector.invoke<{ command: string }>('copy-curl', { id: vm.detail.id, shell: navigator.platform.includes('Win') ? 'powershell' : 'bash' })
    await navigator.clipboard.writeText(result.command)
  }
  const exportHar = async () => {
    const path = window.prompt('HAR export path', 'http-inspector.har')
    if (path) await vm.run('export-har', { path })
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">HTTP</span><div><h1>Inspector</h1><p>{vm.status.running ? `Listening on ${vm.status.proxyUrl}` : 'Capture stopped'}</p></div></div>
      <div className="controls">
        <label className="port">Port<input value={vm.port} min={1024} max={65535} type="number" onChange={event => vm.setPort(Number(event.target.value))} disabled={vm.status.running} /></label>
        <button className={vm.status.running ? 'danger' : 'primary'} disabled={vm.busy} onClick={() => void vm.run(vm.status.running ? 'stop' : 'start', { port: vm.port })}>{vm.status.running ? <CircleStop /> : <Play />}{vm.status.running ? 'Stop' : 'Start'}</button>
        <button title="Install root certificate" onClick={() => void vm.run('install-certificate')}><ShieldCheck /></button>
        <button title="Export HAR" onClick={() => void exportHar()}><Download /></button>
        <button title="Clear sessions" onClick={() => void vm.run('clear')}><Trash2 /></button>
      </div>
    </header>
    <section className="filterbar">
      <Search /><input value={vm.query} onChange={event => vm.setQuery(event.target.value)} placeholder="Filter by method, host, path or status" />
      <span>{vm.rows.length} visible</span><span>{vm.status.total} captured</span><span>Python {vm.status.pythonVersion}</span>
    </section>
    {vm.error && <div className="errorbar">{vm.error}</div>}
    <section className="workspace">
      <div className="sessions">
        <div className="table-head"><span>Status</span><span>Method</span><span>Host</span><span>Path</span><span>Type</span><span>Size</span><span>Time</span></div>
        <div className="table-body">{vm.rows.length ? vm.rows.map(row => <button key={row.id} className={vm.detail?.id === row.id ? 'selected row' : 'row'} onClick={() => void vm.select(row.id)}>
          <span className={`status status-${Math.floor((row.statusCode || 0) / 100)}`}>{row.statusCode || row.state}</span><span className="method">{row.method}</span><span title={row.host}>{row.host}</span><span title={row.path}>{row.path}</span><span>{row.contentType?.split(';')[0] || '-'}</span><span>{formatBytes((row.requestBytes || 0) + (row.responseBytes || 0))}</span><span>{row.durationMs} ms</span>
        </button>) : <div className="empty"><strong>No HTTP sessions</strong><span>Start capture, then configure the client proxy to {vm.status.proxyUrl}.</span></div>}</div>
      </div>
      <aside className="detail">
        {vm.detail ? <><header className="detail-title"><div><b>{vm.detail.method}</b><span>{vm.detail.url}</span></div><button title="Copy as cURL" onClick={() => void copyCurl()}><Copy /></button></header>
          <nav className="tabs"><button className={detailTab === 'overview' ? 'active' : ''} onClick={() => setDetailTab('overview')}>Overview</button><button className={detailTab === 'request' ? 'active' : ''} onClick={() => setDetailTab('request')}>Request</button><button className={detailTab === 'response' ? 'active' : ''} onClick={() => setDetailTab('response')}>Response</button></nav>
          {detailTab === 'overview' && <dl className="overview"><div><dt>URL</dt><dd>{vm.detail.url}</dd></div><div><dt>Status</dt><dd>{vm.detail.statusCode}</dd></div><div><dt>Protocol</dt><dd>{vm.detail.httpVersion}</dd></div><div><dt>Duration</dt><dd>{vm.detail.durationMs} ms</dd></div><div><dt>Content type</dt><dd>{vm.detail.contentType || '-'}</dd></div></dl>}
          {detailTab === 'request' && <MessageView title="Request" message={vm.detail.request} />}{detailTab === 'response' && <MessageView title="Response" message={vm.detail.response} />}
        </> : <div className="empty detail-empty"><strong>Select a session</strong><span>Request and response details appear here.</span></div>}
      </aside>
    </section>
  </main>
}

function formatBytes(value: number) { return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB` }
