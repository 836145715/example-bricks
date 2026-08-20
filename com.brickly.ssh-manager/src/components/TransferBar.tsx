import { transferLine } from '../lib/format'
import type { TransferState } from '../types'

export function TransferBar({ transfer }: { transfer: TransferState }) {
  const percent = transfer.percent ?? 0
  return (
    <div className={`transfer-bar is-${transfer.status}`}>
      <div className="transfer-copy">
        <strong>{transferLine(transfer)}</strong>
        {transfer.remoteDir ? <span>目标 {transfer.remoteDir}</span> : null}
      </div>
      <div className="transfer-meter" aria-hidden="true">
        <i style={{ width: `${Math.max(transfer.status === 'ok' ? 100 : percent, 2)}%` }} />
      </div>
    </div>
  )
}
