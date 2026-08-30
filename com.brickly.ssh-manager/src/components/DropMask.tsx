export function DropMask({ dest }: { dest: string }) {
  return (
    <div className="drop-mask">
      <strong>上传到 {dest}</strong>
      <p>松开后开始传输，不打断终端</p>
    </div>
  )
}
