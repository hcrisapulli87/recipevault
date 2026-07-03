import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'

/**
 * Live webcam barcode scanner. Calls onDetected once with the first code it reads.
 * If the camera can't be opened it shows a note; the caller still offers a typed
 * barcode fallback, so this never blocks logging.
 *
 * Camera lifetime is kept as short as possible (the OS shows a recording indicator
 * the whole time the camera is held): the stream is stopped synchronously on the
 * first successful read, and teardown stops the MediaStream tracks explicitly —
 * zxing's reset() alone leaks the stream if the component unmounts while the
 * camera is still starting up, which kept the camera (and the indicator) live
 * until the whole app closed.
 */
export function BarcodeScanner(props: { onDetected: (code: string) => void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    const video = videoRef.current
    if (!video) return
    let cancelled = false

    const stopStream = (): void => {
      const stream = video.srcObject as MediaStream | null
      stream?.getTracks().forEach((t) => t.stop())
      video.srcObject = null
    }

    reader
      // Prefer the back camera on phones; on a desktop webcam this is a no-op.
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result) => {
        if (result && !detectedRef.current) {
          detectedRef.current = true
          stopStream() // release the camera immediately, don't wait for unmount
          props.onDetected(result.getText())
        }
        // No-result frames throw NotFoundException via the err arg — ignored on purpose.
      })
      // Resolves once the camera is attached; if we were torn down while it was
      // still opening, the cleanup below already ran, so stop the late stream here.
      .then(() => {
        if (cancelled) stopStream()
      })
      .catch(() => {
        if (!cancelled) setError('Could not open the camera. Type the barcode below instead.')
      })

    return () => {
      cancelled = true
      reader.reset()
      stopStream()
    }
    // Mounted fresh each time the Barcode tab starts scanning; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <div className="banner banner--warn">{error}</div>
  return (
    <div className="barcode-scanner">
      {/* playsInline keeps iOS from hijacking the preview into a fullscreen player */}
      <video ref={videoRef} className="barcode-scanner__video" autoPlay muted playsInline />
      <p className="barcode-scanner__hint">
        Point a barcode at the camera… If your phone asks about camera access, choose “While
        using the app” so it doesn’t ask every time.
      </p>
    </div>
  )
}
