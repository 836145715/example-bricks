import React, { useState } from 'react'
import { ConfirmKillModal } from './components/ConfirmKillModal'
import { HeaderHud } from './components/HeaderHud'
import { HoldTable } from './components/HoldTable'
import { MetricsBar } from './components/MetricsBar'
import { ProcessInspectDrawer } from './components/ProcessInspectDrawer'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { useHoldProbe } from './hooks/useHoldProbe'

export function App() {
  const {
    path,
    deep,
    busy,
    error,
    result,
    filterText,
    sortField,
    sortOrder,
    selectedKey,
    inspectHolder,
    processDetails,
    detailsLoadingPid,
    detailsError,
    copiedPid,
    confirmTarget,
    force,
    killingPid,
    modalError,
    filteredHolders,
    setPath,
    setDeep,
    setFilterText,
    toggleSort,
    runProbe,
    handlePickFile,
    handlePickDirectory,
    handleDropFile,
    openInspect,
    closeInspect,
    copyPid,
    confirmKill,
    cancelKill,
    setForce,
    executeKill
  } = useHoldProbe()

  const [dragging, setDragging] = useState(false)
  const isDrawerOpen = Boolean(inspectHolder)

  return (
    <div
      className={`radar${busy ? ' is-scanning' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) handleDropFile(file)
      }}
    >
      {/* 1. 自绘独立标题栏 (自带 Logo 标与关闭按钮) */}
      <TitleBar />

      {/* 2. 探针目标控制舱 (聚焦路径输入与探针控制，无重复标题) */}
      <HeaderHud
        path={path}
        deep={deep}
        busy={busy}
        onPathChange={setPath}
        onDeepChange={setDeep}
        onPickFile={() => void handlePickFile()}
        onPickDirectory={() => void handlePickDirectory()}
        onStartProbe={(target) => void runProbe(target)}
      />

      {/* 3. 目标诊断与快照分析条 */}
      <MetricsBar
        busy={busy}
        error={error}
        path={path}
        deep={deep}
        result={result}
        filterText={filterText}
        filteredCount={filteredHolders.length}
        onFilterTextChange={setFilterText}
      />

      {/* 4. 主舞台（占用矩阵 + 进程详情抽屉） */}
      <main className={`stage${isDrawerOpen ? ' inspect-open' : ''}`}>
        <div className="matrix-wrap">
          <HoldTable
            busy={busy}
            result={result}
            holders={filteredHolders}
            selectedKey={selectedKey}
            copiedPid={copiedPid}
            killingPid={killingPid}
            detailsLoadingPid={detailsLoadingPid}
            sortField={sortField}
            sortOrder={sortOrder}
            onToggleSort={toggleSort}
            onOpenInspect={(h, k) => void openInspect(h, k)}
            onCopyPid={copyPid}
            onConfirmKill={(pid, processName, startKey) => confirmKill(pid, processName, startKey)}
          />
        </div>

        {/* 进程详情 Flex 抽屉（顶头固定、中间全量单一滚动无压扁、底栏强杀按钮锁定） */}
        {inspectHolder ? (
          <ProcessInspectDrawer
            holder={inspectHolder}
            details={processDetails}
            loading={detailsLoadingPid === inspectHolder.pid}
            error={detailsError}
            targetPath={path}
            onClose={closeInspect}
            onConfirmKill={(pid, processName, startKey) => confirmKill(pid, processName, startKey)}
          />
        ) : null}
      </main>

      {/* 5. 底部状态栏 */}
      <StatusBar holdersCount={filteredHolders.length} />

      {/* 6. 自定义赛博风格确认强杀 Modal */}
      {confirmTarget ? (
        <ConfirmKillModal
          target={confirmTarget}
          force={force}
          loading={killingPid === confirmTarget.pid}
          error={modalError}
          targetPath={path}
          onForceChange={setForce}
          onCancel={cancelKill}
          onConfirm={() => void executeKill()}
        />
      ) : null}

      {/* 拖放高亮蒙层 */}
      {dragging ? (
        <div className="drag-overlay">
          <div className="drag-box">
            <span>松开即可锁定文件/文件夹占用</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
