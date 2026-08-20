import clsx from 'clsx'
import { Minus, Plus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { statusLabel } from '../state/manager-state'
import type { Tab } from '../types'

export function Chrome({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab
}: {
  tabs: Tab[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTab: () => void
}) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.brickly?.window
    if (!api) return
    let cancelled = false
    void api.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value)
    })
    const off = api.onMaximizeChange((value) => setMaximized(value))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const api = window.brickly?.window

  return (
    <header className="chrome" aria-label="窗口标题栏">
      <div className="chrome-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={clsx('chrome-tab', activeTabId === tab.id && 'is-active')}
            onClick={() => onSelect(tab.id)}
          >
            {tab.kind === 'session' ? <span className={clsx('status-dot', `is-${tab.status}`)} /> : null}
            <span className="chrome-tab-title">{tab.kind === 'session' ? tab.title : '新连接'}</span>
            {tab.kind === 'session' ? (
              <span className="chrome-tab-meta">{statusLabel(tab.status)}</span>
            ) : null}
            <span
              className="tab-close"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onClose(tab.id)
              }}
            >
              <X size={11} />
            </span>
          </button>
        ))}
        <button type="button" className="chrome-new" title="新连接" onClick={onNewTab}>
          <Plus size={13} strokeWidth={2.2} />
        </button>
      </div>
      <div
        className="chrome-drag"
        onDoubleClick={() => {
          if (api) void api.toggleMaximize()
        }}
      />
      <div className="chrome-controls">
        <button type="button" className="titlebar-btn" title="最小化" disabled={!api} onClick={() => void api?.minimize()}>
          <Minus size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          title={maximized ? '还原' : '最大化'}
          disabled={!api}
          onClick={() => void api?.toggleMaximize()}
        >
          {maximized ? (
            <span className="titlebar-restore" aria-hidden>
              <i />
              <i />
            </span>
          ) : (
            <Square size={12} strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          title="关闭"
          disabled={!api && !window.brickly?.closeWindow}
          onClick={() => {
            if (api) void api.close()
            else window.brickly?.closeWindow?.()
          }}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  )
}
