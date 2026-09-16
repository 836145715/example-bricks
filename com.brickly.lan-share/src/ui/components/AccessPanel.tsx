import { useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, ShieldCheck, Upload } from 'lucide-react'
import { openUrl } from '../brickly'
import type { ShareStatus } from '../types'
import { QrCode } from './QrCode'

interface AccessPanelProps {
  status: ShareStatus
}

/** 访问入口面板：展示局域网访问 URL、二维码与共享特性。 */
export function AccessPanel({ status }: AccessPanelProps) {
  const [copied, setCopied] = useState('')

  // 主访问地址：优先内网地址，回退第一个 URL。
  const primary = useMemo(() => {
    const lan = status.urls.find((item) => item.private)
    return lan ?? status.urls[0]
  }, [status.urls])

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied((current) => (current === url ? '' : current)), 1500)
    } catch {
      // 剪贴板不可用时静默忽略，用户仍可手动复制。
    }
  }

  if (!status.running || !primary) {
    return (
      <section className="panel access-panel empty">
        <div className="empty-hint">
          <p>服务未启动</p>
          <p className="muted">配置共享目录后点击「启动共享」，这里会显示访问地址与二维码。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="panel access-panel">
      <header className="panel-head">
        <h2>访问入口</h2>
        <div className="feature-tags">
          {status.hasAccessCode && (
            <span className="tag">
              <ShieldCheck size={12} /> 访问码
            </span>
          )}
          {status.allowUpload && (
            <span className="tag">
              <Upload size={12} /> 允许上传
            </span>
          )}
        </div>
      </header>

      <div className="access-body">
        <div className="qr-wrap">
          <QrCode value={primary.url} />
          <span className="muted">手机扫码访问</span>
        </div>

        <ul className="url-list">
          {status.urls.map((item) => (
            <li key={item.url} className="url-item">
              <div className="url-meta">
                <span className="mono url-text">{item.url}</span>
                <span className="url-label">{labelFor(item.label, item.private)}</span>
              </div>
              <div className="url-actions">
                <button
                  className="btn ghost icon-btn"
                  title="复制"
                  onClick={() => void handleCopy(item.url)}
                >
                  {copied === item.url ? <Check size={15} /> : <Copy size={15} />}
                </button>
                <button
                  className="btn ghost icon-btn"
                  title="在浏览器打开"
                  onClick={() => void openUrl(item.url)}
                >
                  <ExternalLink size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function labelFor(label: string, isPrivate: boolean): string {
  if (label === 'loopback') return '本机'
  return isPrivate ? `内网 · ${label}` : label
}
