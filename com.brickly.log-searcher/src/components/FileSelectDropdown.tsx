import { ChevronDown, Folder } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatLogFileSize, getLogFileName, type RemoteLogFile } from '../domain/logFiles'
import {
  describeDateFilter,
  formatRelativeModifiedAt,
  getFilePickerTriggerLabel,
  getGroupSelectionState,
  groupRemoteLogFiles,
  isDateFilterActive,
  recentRemoteLogFiles,
  type FileDateFilter,
  type FilePickerSort
} from '../domain/paths'
import type { FileListStatus } from '../types'

interface FileSelectDropdownProps {
  serverId: string
  availableFiles: RemoteLogFile[]
  selectedFiles: string[]
  listStatus: FileListStatus
  dateFilter: FileDateFilter
  dateMatchedPaths: string[]
  onRefresh: () => void
  onChangeSelected: (paths: string[]) => void
}

function GroupCheckbox({
  state,
  onChange
}: {
  state: 'all' | 'some' | 'none'
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === 'some'
    }
  }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'all'}
      onChange={onChange}
    />
  )
}

export function FileSelectDropdown({
  serverId,
  availableFiles,
  selectedFiles,
  listStatus,
  dateFilter,
  dateMatchedPaths,
  onRefresh,
  onChangeSelected
}: FileSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [sort, setSort] = useState<FilePickerSort>('mtime')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const selectedSet = new Set(selectedFiles)
  const dateMatchedSet = new Set(dateMatchedPaths)
  const dateLabel = describeDateFilter(dateFilter)
  const dateActive = isDateFilterActive(dateFilter)

  useEffect(() => {
    setOpen(false)
    setFilterText('')
    setCollapsed({})
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
  const groups = groupRemoteLogFiles(filteredFiles, sort)

  const toggleGroup = (paths: string[], state: 'all' | 'some' | 'none') => {
    if (state === 'all') {
      const remove = new Set(paths)
      onChangeSelected(selectedFiles.filter(path => !remove.has(path)))
      return
    }
    onChangeSelected([...new Set([...selectedFiles, ...paths])])
  }

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
          {getFilePickerTriggerLabel(listStatus, availableFiles, selectedFiles, dateLabel)}
        </span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="dropdown-menu file-picker-menu">
          <div className="dropdown-search">
            <input
              type="text"
              placeholder="过滤文件名或路径…"
              value={filterText}
              onChange={event => setFilterText(event.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="dropdown-actions">
            <button type="button" onClick={() => onChangeSelected(availableFiles.map(file => file.path))}>
              全选
            </button>
            <button
              type="button"
              onClick={() => onChangeSelected(recentRemoteLogFiles(availableFiles).map(file => file.path))}
            >
              最近 5 个
            </button>
            <button type="button" onClick={() => onChangeSelected([])}>
              清空
            </button>
            <button type="button" onClick={onRefresh}>
              刷新
            </button>
            <select
              className="file-picker-sort"
              value={sort}
              onChange={event => setSort(event.target.value as FilePickerSort)}
              title="排序"
            >
              <option value="mtime">最近修改</option>
              <option value="name">文件名</option>
              <option value="size">大小</option>
            </select>
          </div>

          {dateActive && (
            <div className="file-picker-hint">
              已按最后修改日期 {dateLabel} 选中 {dateMatchedPaths.length} 个文件
              {dateMatchedPaths.length === 0 ? '，该范围内没有匹配文件。' : '。'}
            </div>
          )}
          {!dateActive && selectedFiles.length === 0 && availableFiles.length > 0 && (
            <div className="file-picker-hint">未选择时，检索会使用最近修改的 5 个文件。</div>
          )}
          {listStatus === 'loading' && (
            <div className="file-picker-hint">正在通过 SSH 列出远程日志文件…</div>
          )}
          {listStatus === 'error' && (
            <div className="file-picker-hint error">文件列表加载失败，可点刷新重试。</div>
          )}

          <div className="dropdown-list">
            {groups.length === 0 ? (
              <div className="dropdown-empty">
                {listStatus === 'error' ? '没有可显示的文件' : '无匹配的文件'}
              </div>
            ) : (
              groups.map(group => {
                const state = getGroupSelectionState(group.files, selectedSet)
                const isCollapsed = !!collapsed[group.dir]
                return (
                  <section key={group.dir} className="file-picker-group">
                    <div className="file-picker-group-head">
                      <GroupCheckbox
                        state={state}
                        onChange={() => toggleGroup(group.files.map(file => file.path), state)}
                      />
                      <button
                        type="button"
                        className="file-picker-group-toggle"
                        onClick={() => setCollapsed(prev => ({ ...prev, [group.dir]: !prev[group.dir] }))}
                        title={group.dir}
                      >
                        <ChevronDown size={12} className={isCollapsed ? 'is-collapsed' : ''} />
                        <span className="file-picker-dir">{group.dir || '/'}</span>
                        <span className="file-picker-count">
                          {group.files.filter(file => selectedSet.has(file.path)).length}/{group.files.length}
                        </span>
                      </button>
                    </div>
                    {!isCollapsed && group.files.map(file => {
                      const checked = selectedSet.has(file.path)
                      return (
                        <label
                          key={file.path}
                          className={`dropdown-item${dateActive && dateMatchedSet.has(file.path) ? ' is-date-match' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={event => {
                              if (event.target.checked) {
                                onChangeSelected([...selectedFiles, file.path])
                                return
                              }
                              onChangeSelected(selectedFiles.filter(path => path !== file.path))
                            }}
                          />
                          <div className="file-info" title={file.path}>
                            <span className="file-name-span">{getLogFileName(file.path)}</span>
                            <span className="file-path-span">
                              {[
                                file.sizeBytes !== undefined ? formatLogFileSize(file.sizeBytes) : '',
                                formatRelativeModifiedAt(file.modifiedAt)
                              ].filter(Boolean).join(' · ') || file.path}
                            </span>
                          </div>
                        </label>
                      )
                    })}
                  </section>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
