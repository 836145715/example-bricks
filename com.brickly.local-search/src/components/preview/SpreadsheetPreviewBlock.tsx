import { Table2 } from 'lucide-react'
import type { PreviewResult } from '../../types'
import { PreviewState } from './PreviewState'

function columnLabel(index: number) {
  let label = ''
  let temp = index
  while (temp >= 0) {
    label = String.fromCharCode((temp % 26) + 65) + label
    temp = Math.floor(temp / 26) - 1
  }
  return label
}

export function SpreadsheetPreviewBlock({ preview }: { preview: PreviewResult }) {
  const sheets = preview.spreadsheet?.sheets || []
  if (!sheets.length) {
    return (
      <PreviewState
        icon={<Table2 size={28} />}
        title="没有可显示的工作表"
        description={preview.reason || '表格结构可能为空，或当前版本无法解析。'}
      />
    )
  }

  return (
    <div className="preview-sheets">
      {sheets.map((sheet) => {
        const width = Math.max(...sheet.rows.map((row) => row.length), 1)
        return (
          <section className="preview-sheet" key={sheet.name}>
            <div className="preview-sheet-title">
              <Table2 size={14} />
              <span>{sheet.name}</span>
              {sheet.truncated ? <strong>已截断</strong> : null}
            </div>
            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    {Array.from({ length: width }).map((_, cellIndex) => (
                      <th key={cellIndex}>{columnLabel(cellIndex)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <th>{rowIndex + 1}</th>
                      {Array.from({ length: width }).map((_, cellIndex) => (
                        <td key={cellIndex}>{row[cellIndex] || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
