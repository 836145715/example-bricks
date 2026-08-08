import { useState } from 'react'
import { CircleStop, Copy, Download, Play, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { useHttpInspector } from './hooks/useHttpInspector'
import type { Message } from './types'

function MessageView({ title, message }: { title: string; message?: Message }) {
  const [tab, setTab] = useState<'headers' | 'body'>('headers')
  return <section className="message-pane">
    <header><strong>{title}</strong><nav><button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>请求头</button><button className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>请求体</button></nav></header>
    {tab === 'headers' ? <dl>{Object.entries(message?.headers ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <pre>{message?.body || '(空)'}{message?.truncated ? '\n\n[内容已截断]' : ''}</pre>}
  </section>
}

export default function App() {
  const vm = useHttpInspector()
  const [detailTab, setDetailTab] = useState<'overview' | 'request' | 'response'>('overview')
  const copyProxy = async () => {
    await navigator.clipboard.writeText(vm.status.proxyUrl)
  }
  const copyCurl = async () => {
    if (!vm.detail || !window.httpInspector) return
    const result = await window.httpInspector.invoke<{ command: string }>('copy-curl', { id: vm.detail.id, shell: navigator.platform.includes('Win') ? 'powershell' : 'bash' })
    await navigator.clipboard.writeText(result.command)
  }
  const exportHar = async () => {
    const path = window.prompt('HAR 导出路径', 'http-inspector.har')
    if (path) await vm.run('export-har', { path })
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">HTTP</span><div><h1>HTTP 抓包</h1><p>{vm.status.running ? `监听中：${vm.status.proxyUrl}` : '代理已停止'}</p></div></div>
      <div className="controls">
        <label className="port">端口<input value={vm.port} min={1024} max={65535} type="number" onChange={event => vm.setPort(Number(event.target.value))} disabled={vm.status.running} /></label>
        <button className={vm.status.running ? 'danger' : 'primary'} disabled={vm.busy} onClick={() => void vm.run(vm.status.running ? 'stop' : 'start', { port: vm.port })}>{vm.status.running ? <CircleStop /> : <Play />}{vm.status.running ? '停止代理' : '启动代理'}</button>
        <button className="cert-button" title="安装 HTTPS 根证书" onClick={() => void vm.run('install-certificate')}><ShieldCheck />安装证书</button>
        <button title="导出 HAR" onClick={() => void exportHar()}><Download /></button>
        <button title="清空会话" onClick={() => void vm.run('clear')}><Trash2 /></button>
      </div>
    </header>
    <section className="setup-strip">
      <span className={`setup-state ${vm.status.running ? 'ready' : ''}`}><i />{vm.status.running ? '代理已启动' : '代理未启动'}</span>
      <span>客户端代理：<code>{vm.status.proxyUrl}</code></span>
      <button className="copy-proxy" onClick={() => void copyProxy()}>复制地址</button>
      <span className="setup-note">{vm.status.systemProxyWarning || 'HTTPS 请求需先安装根证书'}</span>
    </section>
    <section className="filterbar">
      <Search /><input value={vm.query} onChange={event => vm.setQuery(event.target.value)} placeholder="按方法、主机、路径或状态筛选" />
      <span>{vm.rows.length} 条显示</span><span>{vm.status.total} 条已捕获</span><span>Python {vm.status.pythonVersion}</span>
    </section>
    {vm.error && <div className="errorbar">{vm.error}</div>}
    <section className="workspace">
      <div className="sessions">
        <div className="table-head"><span>状态</span><span>方法</span><span>主机</span><span>路径</span><span>类型</span><span>大小</span><span>耗时</span></div>
        <div className="table-body">{vm.rows.length ? vm.rows.map(row => <button key={row.id} className={vm.detail?.id === row.id ? 'selected row' : 'row'} onClick={() => void vm.select(row.id)}>
          <span className={`status status-${Math.floor((row.statusCode || 0) / 100)}`}>{row.statusCode || row.state}</span><span className="method">{row.method}</span><span title={row.host}>{row.host}</span><span title={row.path}>{row.path}</span><span>{row.contentType?.split(';')[0] || '-'}</span><span>{formatBytes((row.requestBytes || 0) + (row.responseBytes || 0))}</span><span>{row.durationMs} ms</span>
        </button>) : <div className="empty"><strong>{vm.status.running ? '尚未捕获到请求' : '代理尚未启动'}</strong><span>{vm.status.running ? `请将浏览器或客户端的 HTTP/HTTPS 代理设置为 ${vm.status.proxyUrl}。` : '点击“启动代理”，再把浏览器或客户端代理设置为上方地址。'}</span></div>}</div>
      </div>
      <aside className="detail">
        {vm.detail ? <><header className="detail-title"><div><b>{vm.detail.method}</b><span>{vm.detail.url}</span></div><button title="复制为 cURL" onClick={() => void copyCurl()}><Copy /></button></header>
          <nav className="tabs"><button className={detailTab === 'overview' ? 'active' : ''} onClick={() => setDetailTab('overview')}>概览</button><button className={detailTab === 'request' ? 'active' : ''} onClick={() => setDetailTab('request')}>请求</button><button className={detailTab === 'response' ? 'active' : ''} onClick={() => setDetailTab('response')}>响应</button></nav>
          {detailTab === 'overview' && <dl className="overview"><div><dt>地址</dt><dd>{vm.detail.url}</dd></div><div><dt>状态码</dt><dd>{vm.detail.statusCode}</dd></div><div><dt>协议</dt><dd>{vm.detail.httpVersion}</dd></div><div><dt>耗时</dt><dd>{vm.detail.durationMs} ms</dd></div><div><dt>内容类型</dt><dd>{vm.detail.contentType || '-'}</dd></div></dl>}
          {detailTab === 'request' && <MessageView title="请求" message={vm.detail.request} />}{detailTab === 'response' && <MessageView title="响应" message={vm.detail.response} />}
        </> : <div className="empty detail-empty"><strong>选择一条会话</strong><span>请求和响应详情会显示在这里。</span></div>}
      </aside>
    </section>
  </main>
}

function formatBytes(value: number) { return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB` }
