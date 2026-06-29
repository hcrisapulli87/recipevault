import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'

/**
 * Live webcam barcode scanner. Calls onDetected once with the first code it reads.
 * If the camera can't be opened it shows a note; the caller still offers a typed
 * barcode fallback, so this never blocks logging.
 */
export function BarcodeScanner(props: { onDetected: (code: string) => void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    const video = videoRef.current
    if (!video) return

    reader
      .decodeFromVideoDevice(null, video, (result) => {
        if (result && !detectedRef.current) {
          detectedRef.current = true
          props.onDetected(result.getText())
        }
        // No-result frames throw NotFoundException via the err arg — ignored on purpose.
      })
      .catch(() => setError('Could not open the camera. Type the barcode below instead.'))

    return () => reader.reset()
    // Mounted fresh each time the Barcode tab starts scanning; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <div className="banner banner--warn">{error}</div>
  return (
    <div className="barcode-scanner">
      <video ref={videoRef} className="barcode-scanner__video" />
      <p className="barcode-scanner__hint">Point a barcode at the camera…</p>
    </div>
  )
}
