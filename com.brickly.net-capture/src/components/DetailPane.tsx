import { useState } from 'react'
import clsx from 'clsx'
import { DetailTab } from '../types'
import { Copy, Check } from 'lucide-react'

type DetailPaneProps = {
  activeTab: string
  body: string
  imageSrc?: string
  tabs: DetailTab[]
  onTabChange: (tab: string) => void
  paneTitle: string // "请求详情" or "响应详情"
}

export function DetailPane({
  activeTab,
  body,
  imageSrc,
  tabs,
  onTabChange,
  paneTitle
}: DetailPaneProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!body) return
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy: ', err)
    }
  }

  const isCopyable = activeTab !== 'image' && body && body.trim().length > 0

  return (
    <section className="detail-pane">
      <div className="detail-header">
        <span className="pane-title">{paneTitle}</span>
        {isCopyable && (
          <button 
            className={clsx("pane-copy-btn", copied && "pane-copied")} 
            onClick={handleCopy} 
            title="复制当前视图内容"
            type="button"
          >
            {copied ? <Check size={12} className="check-icon" /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        )}
      </div>
      <div className="detail-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={clsx(activeTab === tab.id && 'detail-tab-active')}
            onClick={() => onTabChange(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="detail-content">
        {activeTab === 'image' && imageSrc ? (
          <div className="image-preview">
            <img alt="响应图片预览" src={imageSrc} />
          </div>
        ) : (
          <DetailContentRenderer activeTab={activeTab} body={body} />
        )}
      </div>
    </section>
  )
}

function DetailContentRenderer({ activeTab, body }: { activeTab: string; body: string }) {
  if (!body || !body.trim()) {
    return <pre className="detail-raw-text">(空)</pre>
  }

  try {
    if (activeTab === 'headers') {
      return <StructuredHeadersRenderer body={body} />
    }
    if (activeTab === 'params' || activeTab === 'cookies') {
      return <StructuredKeyValueRenderer body={body} separator={activeTab === 'cookies' ? ';' : '\n'} />
    }
    if (activeTab === 'json') {
      return <HighlightedJsonRenderer body={body} />
    }
  } catch (err) {
    console.warn('Failed to parse structured view, falling back to raw', err)
  }

  // 默认文本、HEX、原始请求等回退渲染
  return <pre className="detail-raw-text">{body}</pre>
}

// 1. 结构化协议头渲染器
function StructuredHeadersRenderer({ body }: { body: string }) {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return <pre className="detail-raw-text">{body}</pre>

  const firstLine = lines[0]
  const headerPairs: Array<{ key: string; value: string }> = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const colonIdx = line.indexOf(':')
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      headerPairs.push({ key, value })
    } else {
      headerPairs.push({ key: '', value: line })
    }
  }

  const firstLineParts = firstLine.split(' ')
  const isRequest = !firstLine.startsWith('HTTP/')

  return (
    <div className="structured-headers">
      {/* 首行高亮：提取 Method / Status-Code */}
      <div className="headers-first-line">
        {isRequest ? (
          <>
            <span className={clsx("method-badge", `method-${firstLineParts[0]?.toLowerCase()}`)}>
              {firstLineParts[0]}
            </span>
            <span className="first-line-path">{firstLineParts[1]}</span>
            <span className="first-line-proto">{firstLineParts[2]}</span>
          </>
        ) : (
          <>
            <span className="first-line-proto">{firstLineParts[0]}</span>
            <span className={clsx(
              "status-badge",
              firstLineParts[1] && firstLineParts[1].startsWith('2') && "status-badge-success",
              firstLineParts[1] && firstLineParts[1].startsWith('3') && "status-badge-redirect",
              firstLineParts[1] && (firstLineParts[1].startsWith('4') || firstLineParts[1].startsWith('5')) && "status-badge-error"
            )}>
              {firstLineParts[1]}
            </span>
            <span className="first-line-status-text">{firstLineParts.slice(2).join(' ')}</span>
          </>
        )}
      </div>

      {/* 头域表格 */}
      <div className="headers-grid">
        {headerPairs.map((pair, idx) => (
          <div key={idx} className="header-row">
            {pair.key ? (
              <>
                <span className="header-key" title={pair.key}>{pair.key}</span>
                <span className="header-value" title={pair.value}>{pair.value}</span>
              </>
            ) : (
              <span className="header-row-raw">{pair.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// 2. 结构化 Key-Value 渲染器 (参数和 Cookies)
function StructuredKeyValueRenderer({ body, separator }: { body: string; separator: string }) {
  const pairs: Array<{ key: string; value: string }> = []
  
  if (separator === ';') {
    // 解析 Cookie 键值对: name=value; name2=value2
    const items = body.split(';').map(item => item.trim()).filter(Boolean)
    for (const item of items) {
      const eqIdx = item.indexOf('=')
      if (eqIdx !== -1) {
        pairs.push({
          key: item.slice(0, eqIdx).trim(),
          value: item.slice(eqIdx + 1).trim()
        })
      } else {
        pairs.push({ key: item, value: '' })
      }
    }
  } else {
    // 解析 URL Params: name=value (换行分隔)
    const lines = body.split('\n').map(line => line.trim()).filter(Boolean)
    for (const line of lines) {
      const eqIdx = line.indexOf('=')
      if (eqIdx !== -1) {
        pairs.push({
          key: line.slice(0, eqIdx).trim(),
          value: line.slice(eqIdx + 1).trim()
        })
      } else {
        pairs.push({ key: line, value: '' })
      }
    }
  }

  if (pairs.length === 0) {
    return <pre className="detail-raw-text">{body}</pre>
  }

  return (
    <div className="structured-kv">
      <div className="kv-grid">
        <div className="kv-header-row">
          <div className="kv-head-col">键 (Key)</div>
          <div className="kv-head-col">值 (Value)</div>
        </div>
        {pairs.map((pair, idx) => (
          <div key={idx} className="kv-row">
            <span className="kv-key" title={pair.key}>{pair.key}</span>
            <span className="kv-value" title={pair.value}>{pair.value || <span className="kv-empty">(空)</span>}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 3. 语法高亮 JSON 渲染器
function HighlightedJsonRenderer({ body }: { body: string }) {
  let prettyJson = body
  try {
    const parsed = JSON.parse(body)
    prettyJson = JSON.stringify(parsed, null, 2)
  } catch {}

  const highlightedHtml = highlightJson(prettyJson)

  return (
    <pre 
      className="detail-json-highlighted"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  )
}

function highlightJson(jsonStr: string): string {
  if (!jsonStr) return ''
  const escaped = jsonStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number'
      if (match.startsWith('"')) {
        if (match.endsWith(':')) {
          cls = 'json-key'
        } else {
          cls = 'json-string'
        }
      } else if (match === 'true' || match === 'false') {
        cls = 'json-boolean'
      } else if (match === 'null') {
        cls = 'json-null'
      }
      return `<span class="json-token ${cls}">${match}</span>`
    }
  )
}
