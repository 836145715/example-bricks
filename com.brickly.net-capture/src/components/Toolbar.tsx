import {
  Copy,
  Download,
  Eraser,
  FileKey2,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun
} from 'lucide-react'
import { StatusFilter } from '../types'

type ToolbarProps = {
  query: string
  setQuery: (q: string) => void
  protocol: string
  setProtocol: (p: string) => void
  statusFilter: StatusFilter
  setStatusFilter: (sf: StatusFilter) => void
  copyProxy: () => void
  installCert: () => void
  installCertSupported: boolean
  toggleSystemProxy: () => void
  systemProxySupported: boolean
  systemProxyEnabled: boolean
  running: boolean
  refreshStatus: () => void
  clear: () => void
  exportSessions: () => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  autoScroll: boolean
  setAutoScroll: (val: boolean) => void
  notice: string
}

const protocolOptions = ['all', 'HTTP', 'WS', 'TCP', 'UDP']
const statusFilterOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态码' },
  { value: 'success', label: '成功 (2xx)' },
  { value: 'redirect', label: '重定向 (3xx)' },
  { value: 'clientError', label: '客户端错误 (4xx)' },
  { value: 'serverError', label: '服务端错误 (5xx)' },
  { value: 'errors', label: '异常连接 / Error' }
]

export function Toolbar({
  query,
  setQuery,
  protocol,
  setProtocol,
  statusFilter,
  setStatusFilter,
  copyProxy,
  installCert,
  installCertSupported,
  toggleSystemProxy,
  systemProxySupported,
  systemProxyEnabled,
  running,
  refreshStatus,
  clear,
  exportSessions,
  theme,
  toggleTheme,
  autoScroll,
  setAutoScroll,
  notice
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <div className="search">
        <Search size={14} className="search-icon" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="过滤 URL、Host、进程、地址、ID..." />
      </div>

      <div className="filters-group">
        <select value={protocol} onChange={(event) => setProtocol(event.target.value)} className="select-field">
          {protocolOptions.map((item) => (
            <option key={item} value={item}>
              {item === 'all' ? '全部协议' : item}
            </option>
          ))}
        </select>

        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="select-field">
          {statusFilterOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="action-buttons">
        <button onClick={copyProxy} type="button" title="复制代理地址">
          <Copy size={14} />
        </button>
        <button
          onClick={installCert}
          type="button"
          title={installCertSupported ? '安装 HTTPS 根证书' : '当前平台不支持自动安装根证书'}
          disabled={!installCertSupported}
        >
          <FileKey2 size={14} />
        </button>
        <button
          onClick={toggleSystemProxy}
          type="button"
          title={systemProxySupported ? '设置/取消系统代理' : '当前平台不支持自动设置系统代理'}
          disabled={!running || !systemProxySupported}
          className={systemProxyEnabled ? 'btn-active-glow' : ''}
        >
          <ShieldCheck size={14} />
        </button>
        <button onClick={refreshStatus} type="button" title="刷新状态">
          <RefreshCw size={14} />
        </button>
        <button onClick={exportSessions} type="button" title="导出抓包数据 (JSON)">
          <Download size={14} />
        </button>
        <button onClick={toggleTheme} type="button" title="切换主题配色" className="theme-toggle-btn">
          {theme === 'dark' ? <Sun size={14} className="sun-icon" /> : <Moon size={14} className="moon-icon" />}
        </button>
        <button onClick={clear} type="button" title="清空所有会话" className="btn-danger-hover">
          <Eraser size={14} />
        </button>
      </div>

      <div className="scroll-and-notice">
        <label className="auto-scroll">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          <span>自动滚动</span>
        </label>
        <span className="notice" title={notice}>{notice}</span>
      </div>
    </section>
  )
}
