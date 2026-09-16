import React, { useEffect, useMemo } from 'react'

import { Breadcrumb } from './components/Breadcrumb'
import { CollectorTray } from './components/CollectorTray'
import { ConfirmTrash } from './components/ConfirmTrash'
import { ExtLegend } from './components/ExtLegend'
import { NodeList } from './components/NodeList'
import { Pie } from './components/Pie'
import { EmptyState, ScanOverlay } from './components/ScanOverlay'
import { TitleBar } from './components/TitleBar'
import { Treemap } from './components/Treemap'
import { VolumeBar } from './components/VolumeBar'
import { emptyHintFor } from './emptyHint'
import { useDiskMap } from './hooks/useDiskMap'

export const App: React.FC = () => {
  const state = useDiskMap()
  const {
    bootError,
    volume,
    root,
    currentPath,
    currentNode,
    selectedPath,
    setSelectedPath,
    scanStatus,
    scanMessage,
    scanned,
    tray,
    confirmOpen,
    setConfirmOpen,
    trashing,
    trashFailures,
    inaccessibleCount,
    view,
    setView,
    extStats,
    canGoUp,
    drillUp,
    drillDown,
    gotoRoot
  } = state

  const trayPaths = useMemo(() => new Set(tray.map((item) => item.path)), [tray])

  const emptyHint = emptyHintFor(scanStatus)

  // idle 引导选目录；cancelled / error 引导重扫。
  const emptyCopy =
    scanStatus === 'cancelled'
      ? {
          title: '扫描已取消',
          sub: '已有数据保留在列表里。点重新扫描可继续。',
          icon: 'refresh' as const,
          actionLabel: '重新扫描',
          onAction: () => void state.startScan()
        }
      : scanStatus === 'error'
        ? {
            title: '扫描出错',
            sub: scanMessage,
            icon: 'refresh' as const,
            actionLabel: '重新扫描',
            onAction: () => void state.startScan()
          }
        : {
            title: '还没有扫描数据',
            sub: '选择一个目录，地图会实时显示每个文件占用的空间。',
            icon: 'folder' as const,
            actionLabel: '选择文件夹',
            onAction: () => void state.chooseRoot()
          }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      event.preventDefault()
      void drillUp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drillUp])

  if (bootError) {
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="boot-error">{bootError}</div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <VolumeBar
        volume={volume}
        root={currentPath || root}
        status={scanStatus}
        message={scanMessage}
        scannedFiles={scanned.files}
        inaccessibleCount={inaccessibleCount}
        onPickRoot={() => void state.chooseRoot()}
        onStopScan={state.stopScan}
        onRescan={() => void state.startScan()}
      />

      <main className="stage">
        <section className="chart-pane">
          <div className="chart-toolbar">
            <div className="view-switch" role="tablist" aria-label="图视图">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'pie'}
                className={view === 'pie' ? 'active' : ''}
                onClick={() => setView('pie')}
              >
                饼图
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'treemap'}
                className={view === 'treemap' ? 'active' : ''}
                onClick={() => setView('treemap')}
              >
                矩阵树图
              </button>
            </div>
          </div>
          <div className="chart-body">
            {view === 'pie' ? (
              <Pie
                node={currentNode}
                volume={volume}
                selectedPath={selectedPath}
                scanning={scanStatus === 'scanning'}
                canGoUp={canGoUp}
                onSelect={setSelectedPath}
                onDrill={(path) => void drillDown(path)}
                onGoUp={() => void drillUp()}
              />
            ) : (
              <Treemap
                node={currentNode}
                selectedPath={selectedPath}
                scanning={scanStatus === 'scanning'}
                onSelect={setSelectedPath}
                onDrill={(path) => void drillDown(path)}
              />
            )}
            <ScanOverlay
              visible={scanStatus === 'booting' || (scanStatus === 'scanning' && !currentNode)}
              scannedFiles={scanned.files}
              scannedBytes={scanned.bytes}
              currentPath={currentPath || root}
              message={scanMessage}
            />
            <EmptyState
              visible={(scanStatus === 'idle' || scanStatus === 'cancelled' || scanStatus === 'error') && !currentNode}
              title={emptyCopy.title}
              sub={emptyCopy.sub}
              icon={emptyCopy.icon}
              actionLabel={emptyCopy.actionLabel}
              onAction={emptyCopy.onAction}
            />
          </div>
          <ExtLegend items={extStats} />
        </section>

        <section className="list-pane">
          <div className="crumb-row">
            <Breadcrumb root={root} path={currentPath || root} onNavigate={(path) => void drillDown(path)} />
            <button
              type="button"
              className="btn btn-ghost crumb-root"
              disabled={!canGoUp}
              onClick={() => void gotoRoot()}
            >
              回到根目录
            </button>
          </div>
          <div className="list-head">
            {currentNode && (
              <span className="list-title" title={currentNode.path}>
                {currentNode.name}
                <em>
                  {currentNode.fileCount.toLocaleString()} 个文件 · {currentNode.dirCount.toLocaleString()} 个文件夹
                </em>
              </span>
            )}
            {selectedPath && selectedPath !== currentPath && (
              <button type="button" className="btn btn-ghost" onClick={() => setSelectedPath(null)}>
                取消选中
              </button>
            )}
          </div>
          <NodeList
            node={currentNode}
            total={currentNode?.allocatedBytes ?? 0}
            selectedPath={selectedPath}
            trayPaths={trayPaths}
            emptyHint={emptyHint}
            onSelect={setSelectedPath}
            onDrill={(path) => void drillDown(path)}
            onAddToTray={(node) => state.addToTray(node)}
            onRemoveFromTray={state.removeFromTray}
            onReveal={state.reveal}
          />
        </section>
      </main>

      <CollectorTray
        items={tray}
        onRemove={state.removeFromTray}
        onClear={state.clearTray}
        onConfirm={() => setConfirmOpen(true)}
      />

      <ConfirmTrash
        open={confirmOpen}
        items={tray}
        trashing={trashing}
        failures={trashFailures}
        onConfirm={() => void state.confirmTrash()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
