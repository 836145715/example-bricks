import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface QrCodeProps {
  value: string
  size?: number
}

/** 将访问 URL 渲染为二维码图片，方便手机扫码访问。 */
export function QrCode({ value, size = 168 }: QrCodeProps) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setFailed(false)
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' }
    })
      .then((url) => {
        if (active) setSrc(url)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [value, size])

  if (failed) {
    return <div className="qr-placeholder">二维码生成失败</div>
  }
  if (!src) {
    return <div className="qr-placeholder" style={{ width: size, height: size }} />
  }
  return <img className="qr-image" src={src} width={size} height={size} alt="访问二维码" />
}
