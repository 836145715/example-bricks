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
    forceKill,
    setForceKill,
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
      {/* 顶部控制台 */}
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
        forceKill={forceKill}
        setForceKill={setForceKill}
        busy={busy}
        canLookup={canLookup}
        onRunLookup={runLookup}
        onRunList={runList}
        onRefresh={refresh}
      />

      {/* 指标与提示栏 */}
      <MetricsBar summary={summary} notice={notice} lastKill={lastKill} />

      {/* 主舞台：表格矩阵 + 右侧/底部检视抽屉 */}
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
          forceKill={forceKill}
          killingPid={killingPid}
          onClose={closeInspect}
          onCopyText={copyText}
          onConfirmKill={promptKill}
        />
      </div>

      {/* 底部状态指示 */}
      <StatusBar
        platform={result?.platform}
        method={result?.method}
        forceKill={forceKill}
        brickId={window.brickly?.brickId}
      />

      {/* 自定义赛博暗黑风格强杀确认模态框 */}
      <ConfirmKillModal
        open={confirmTarget !== null}
        pid={confirmTarget?.pid ?? null}
        processName={confirmTarget?.processName}
        forceKill={forceKill}
        killing={killingPid !== null}
        onConfirm={executeKill}
        onCancel={cancelKill}
      />
    </div>
  )
}
