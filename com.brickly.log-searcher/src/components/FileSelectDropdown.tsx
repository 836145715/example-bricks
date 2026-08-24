import { Folder } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatLogFileSize, getLogFileName, type RemoteLogFile } from '../domain/logFiles'
import type { FileListStatus } from '../types'

interface FileSelectDropdownProps {
  serverId: string
  availableFiles: RemoteLogFile[]
  selectedFiles: string[]
  listStatus: FileListStatus
  onRefresh: () => void
  onChangeSelected: (paths: string[]) => void
}

const getTriggerLabel = (
  listStatus: FileListStatus,
  availableCount: number,
  selectedCount: number
): string => {
  if (availableCount === 0 && listStatus === 'loading') return '加载文件中...'
  if (availableCount === 0 && listStatus === 'error') return '文件加载失败'
  if (availableCount === 0) return '未发现可检索的文本日志'
  if (selectedCount === 0) return '未选文件(默认前5个)'
  if (selectedCount === availableCount) return '已选择全部文件'
  return `已选 ${selectedCount}/${availableCount} 个文件`
}

export function FileSelectDropdown({
  serverId,
  availableFiles,
  selectedFiles,
  listStatus,
  onRefresh,
  onChangeSelected
}: FileSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setOpen(false)
    setFilterText('')
  }, [serverId])

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const filteredFiles = availableFiles.filter(file =>
    file.path.toLowerCase().includes(filterText.toLowerCase())
  )

  return (
    <div className="file-select-dropdown" ref={dropdownRef}>
      <button
        className="btn btn-secondary dropdown-trigger"
        onClick={() => setOpen(prev => !prev)}
        type="button"
        title="选择需要检索的具体日志文件"
      >
        <Folder size={14} />
        <span className="trigger-text">
          {getTriggerLabel(listStatus, availableFiles.length, selectedFiles.length)}
        </span>
      </button>

      {open && (
        <div className="dropdown-menu">
          <div className="dropdown-search">
            <input
              type="text"
              placeholder="搜索文件名..."
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              spellCheck={false}
            />
          </div>

          <div className="dropdown-actions">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onChangeSelected(availableFiles.map(file => file.path))
              }}
            >
              全选
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onChangeSelected([])
              }}
            >
              清空
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRefresh()
              }}
            >
              刷新
            </button>
          </div>

          <div className="dropdown-list">
            {filteredFiles.length === 0 ? (
              <div className="dropdown-empty">无匹配的文件</div>
            ) : (
              filteredFiles.map(file => {
                const isChecked = selectedFiles.includes(file.path)
                return (
                  <label key={file.path} className="dropdown-item" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) => {
                        if (event.target.checked) {
                          onChangeSelected([...selectedFiles, file.path])
                          return
                        }
                        onChangeSelected(selectedFiles.filter(path => path !== file.path))
                      }}
                    />
                    <div className="file-info" title={file.path}>
                      <span className="file-name-span">{getLogFileName(file.path)}</span>
                      <span className="file-path-span">{file.path}</span>
                    </div>
                    {file.sizeBytes !== undefined && (
                      <span className="file-size-span">{formatLogFileSize(file.sizeBytes)}</span>
                    )}
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
