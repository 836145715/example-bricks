/**
 * 端口占用查询与进程管理 - 主应用入口
 */

import clsx from 'clsx'
import React from 'react'
import { ConfirmKillModal } from './components/ConfirmKillModal'
import { HeaderHud } from './components/HeaderHud'
import { MetricsBar } from './components/MetricsBar'
import { PortTable } from './components/PortTable'
import { ProcessInspectDrawer } from './components/ProcessInspectDrawer'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { usePortInspector } from './hooks/usePortInspector'

export function App() {
  const {
    mode,
    setMode,
    port,
    setPort,
    query,
    setQuery,
    protocol,
    setProtocol,
    includeEstablished,
    setIncludeEstablished,
    busy,
    killingPid,
    copiedPid,
    result,
    lastKill,
    details,
    detailsLoadingPid,
    inspectOpen,
    selectedKey,
    inspectError,
    notice,
    summary,
    processedRows,
    sortField,
    sortOrder,
    canLookup,
    confirmTarget,
    toggleSort,
    runLookup,
    runList,
    refresh,
    copyPid,
    copyText,
    openInspect,
    closeInspect,
    promptKill,
    cancelKill,
    executeKill
  } = usePortInspector()

  return (
    <div className={clsx('radar', busy && 'is-scanning')}>
      <TitleBar />

      <HeaderHud
        mode={mode}
        setMode={setMode}
        port={port}
        setPort={setPort}
        query={query}
        setQuery={setQuery}
        protocol={protocol}
        setProtocol={setProtocol}
        includeEstablished={includeEstablished}
        setIncludeEstablished={setIncludeEstablished}
        busy={busy}
        canLookup={canLookup}
        onRunLookup={runLookup}
        onRunList={runList}
        onRefresh={refresh}
      />

      <MetricsBar summary={summary} notice={notice} lastKill={lastKill} />

      <div className={clsx('stage', inspectOpen && 'inspect-open')}>
        <PortTable
          mode={mode}
          busy={busy}
          canLookup={canLookup}
          rows={processedRows}
          generatedAt={result ? new Date(result.generatedAt).toLocaleTimeString() : '尚未扫描'}
          selectedKey={selectedKey}
          copiedPid={copiedPid}
          killingPid={killingPid}
          detailsLoadingPid={detailsLoadingPid}
          sortField={sortField}
          sortOrder={sortOrder}
          onToggleSort={toggleSort}
          onOpenInspect={openInspect}
          onCopyPid={copyPid}
          onConfirmKill={promptKill}
        />

        <ProcessInspectDrawer
          open={inspectOpen}
          details={details}
          loadingPid={detailsLoadingPid}
          error={inspectError}
          killingPid={killingPid}
          onClose={closeInspect}
          onCopyText={copyText}
          onConfirmKill={promptKill}
        />
      </div>

      <StatusBar
        platform={result?.platform}
        method={result?.method}
        brickId={window.brickly?.ref?.brickId}
      />

      <ConfirmKillModal
        open={confirmTarget !== null}
        pid={confirmTarget?.pid ?? null}
        processName={confirmTarget?.processName}
        platform={result?.platform}
        killing={killingPid !== null}
        onConfirm={executeKill}
        onCancel={cancelKill}
      />
    </div>
  )
}
