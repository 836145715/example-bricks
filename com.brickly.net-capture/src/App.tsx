import clsx from 'clsx'
import {
  BadgeAlert,
  Cable,
  CircleStop,
  Gauge,
  Globe2,
  MonitorCog,
  Play,
  ShieldCheck,
  Wifi,
  Inbox
} from 'lucide-react'
import { useCapture } from './hooks/useCapture'
import { Toggle } from './components/Toggle'
import { Metric } from './components/Metric'
import { Toolbar } from './components/Toolbar'
import { SessionTable } from './components/SessionTable'
import { DetailPane } from './components/DetailPane'
import { formatBytes, driverLabel } from './utils/formatters'
import {
  renderRequestTab,
  renderResponseTab,
  responseImageSrc
} from './utils/parsers'
import { DetailTab, DriverMode } from './types'

// 请求详情标签页配置
const requestTabs: DetailTab[] = [
  { id: 'headers', label: '协议头' },
  { id: 'text', label: '请求文本' },
  { id: 'hex', label: '十六进制' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'params', label: '查询参数' },
  { id: 'raw', label: '原始请求' },
  { id: 'json', label: 'JSON美化' }
]

// 响应详情标签页配置
const responseTabs: DetailTab[] = [
  { id: 'headers', label: '协议头' },
  { id: 'text', label: '返回文本' },
  { id: 'image', label: '图片预览' },
  { id: 'hex', label: '十六进制' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'raw', label: '原始返回' },
  { id: 'json', label: 'JSON美化' }
]

export function App() {
  const c = useCapture()
  const platformLabel =
    c.status.capabilities.platformKey && c.status.capabilities.platformKey !== 'unknown'
      ? c.status.capabilities.platformKey
      : `${c.status.capabilities.goos}/${c.status.capabilities.goarch}`

  return (
    <main className="shell" data-theme={c.theme}>
      {/* 顶部标题栏 & 基础抓包设置 */}
      <header className="topbar">
        <div className="brand">
          <Wifi size={19} className="wifi-brand-icon" />
          <div>
            <strong>网络抓包</strong>
            <span>SunnyNet · Go runtime · {platformLabel}</span>
          </div>
        </div>
        <div className="top-actions">
          <label className="port-field">
            <span>端口</span>
            <input
              type="number"
              value={c.port}
              onChange={(event) => c.setPort(Number(event.target.value) || 2025)}
              disabled={c.status.running}
            />
          </label>
          <Toggle label="TCP" checked={c.captureTcp} onChange={c.setCaptureTcp} disabled={c.status.running} />
          <Toggle label="UDP" checked={c.captureUdp} onChange={c.setCaptureUdp} disabled={c.status.running} />
          <label className="driver-field">
            <span>驱动</span>
            <select
              value={c.driverMode}
              onChange={(event) => c.setDriverMode(event.target.value as DriverMode)}
              disabled={c.status.running}
            >
              {c.status.capabilities.driverModes.map((item) => (
                <option key={item.value} value={item.value} disabled={!item.supported} title={item.reason}>
                  {item.supported ? item.label : `${driverLabel(item.value)} (不可用)`}
                </option>
              ))}
            </select>
          </label>
          <button
            className={clsx('primary', c.status.running && 'danger')}
            onClick={c.status.running ? c.stop : c.start}
            disabled={c.busy}
            type="button"
          >
            {c.status.running ? <CircleStop size={16} /> : <Play size={16} />}
            <span>{c.status.running ? '停止' : '启动'}</span>
          </button>
        </div>
      </header>

      {/* 运行时网络核心指标卡片 */}
      <section className="metrics">
        <Metric icon={<Globe2 size={16} />} label="总会话数" value={c.status.total} />
        <Metric icon={<Gauge size={16} />} label="视图流量" value={formatBytes(c.bytesInView)} />
        <Metric
          icon={<BadgeAlert size={16} />}
          label="丢弃会话"
          value={c.status.dropped}
          tone={c.status.dropped ? 'bad' : 'ok'}
        />
        <Metric icon={<Cable size={16} />} label="代理地址" value={c.status.proxyUrl || '-'} />
        <Metric icon={<MonitorCog size={16} />} label="平台" value={platformLabel} />
        <Metric
          icon={<ShieldCheck size={16} />}
          label="网络驱动"
          value={driverLabel(c.status.driverMode)}
          tone={c.status.driverMode === 'off' ? undefined : 'ok'}
        />
        <span className={clsx('run-state', c.status.running && 'run-state-on')}>
          {c.status.running ? '运行中' : '未启动'}
        </span>
      </section>

      {/* 高级交互工具栏 */}
      <Toolbar
        query={c.query}
        setQuery={c.setQuery}
        protocol={c.protocol}
        setProtocol={c.setProtocol}
        statusFilter={c.statusFilter}
        setStatusFilter={c.setStatusFilter}
        copyProxy={c.copyProxy}
        installCert={c.installCert}
        installCertSupported={c.status.capabilities.installCert}
        toggleSystemProxy={c.toggleSystemProxy}
        systemProxySupported={c.status.capabilities.systemProxy}
        systemProxyEnabled={c.status.systemProxy}
        running={c.status.running}
        refreshStatus={() => void c.refreshStatus()}
        clear={c.clear}
        exportSessions={c.exportSessions}
        theme={c.theme}
        toggleTheme={c.toggleTheme}
        autoScroll={c.autoScroll}
        setAutoScroll={c.setAutoScroll}
        notice={c.notice}
      />

      {/* 工作区：左侧列表，右侧详情 */}
      <section className="workspace">
        <SessionTable
          visibleRows={c.visibleRows}
          selectedId={c.selectedId}
          loadDetail={c.loadDetail}
          viewportRef={c.viewportRef}
          sortField={c.sortField}
          sortOrder={c.sortOrder}
          changeSort={c.changeSort}
        />

        <aside className={clsx('detail', !c.detail && 'detail-empty')}>
          {c.detail ? (
            <>
              <DetailPane
                paneTitle="请求报文 (Request)"
                activeTab={c.requestTab}
                body={renderRequestTab(c.detail, c.requestTab)}
                imageSrc={undefined}
                tabs={requestTabs}
                onTabChange={c.setRequestTab}
              />
              <DetailPane
                paneTitle="响应报文 (Response)"
                activeTab={c.responseTab}
                body={renderResponseTab(c.detail, c.responseTab)}
                imageSrc={responseImageSrc(c.detail)}
                tabs={responseTabs}
                onTabChange={c.setResponseTab}
              />
            </>
          ) : (
            <div className="detail-empty-placeholder">
              <div className="placeholder-icon">
                <Inbox size={48} className="placeholder-icon-svg" />
              </div>
              <h3>暂无选中会话</h3>
              <p>在左侧列表中点击任意行，此处即可查看完整的 HTTP 协议头、请求体、响应内容、Hex 十六进制或美化后的 JSON。</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  )
}
