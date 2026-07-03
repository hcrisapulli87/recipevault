import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from '@zxing/library'

/**
 * Live webcam barcode scanner. Calls onDetected once with the first confirmed code.
 * If the camera can't be opened it shows a note; the caller still offers a typed
 * barcode fallback, so this never blocks logging.
 *
 * Accuracy: decoding is restricted to the retail formats (EAN/UPC — all food
 * barcodes), which carry a check digit. Without this, zxing also tries
 * checksum-less formats like Code 39/ITF, and a blurry EAN frame regularly
 * "succeeds" as garbage in one of those. A code is only accepted after two
 * consecutive frames agree.
 *
 * Camera lifetime is kept as short as possible (the OS shows a recording indicator
 * the whole time the camera is held): the stream is stopped synchronously on the
 * confirmed read, and teardown stops the MediaStream tracks explicitly —
 * zxing's reset() alone leaks the stream if the component unmounts while the
 * camera is still starting up, which kept the camera (and the indicator) live
 * until the whole app closed.
 */
export function BarcodeScanner(props: { onDetected: (code: string) => void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectedRef = useRef(false)
  const lastReadRef = useRef<{ code: string; count: number }>({ code: '', count: 0 })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E
    ])
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new BrowserMultiFormatReader(hints)
    const video = videoRef.current
    if (!video) return
    let cancelled = false

    const stopStream = (): void => {
      const stream = video.srcObject as MediaStream | null
      stream?.getTracks().forEach((t) => t.stop())
      video.srcObject = null
    }

    reader
      // Back camera on phones (no-op on a desktop webcam); ask for a sharp feed —
      // 1D barcodes need resolvable line widths, and low-res defaults blur them.
      .decodeFromConstraints(
        {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        },
        video,
        (result) => {
          if (!result || detectedRef.current) return
          // Two consecutive frames must agree before we trust the read.
          const code = result.getText()
          const last = lastReadRef.current
          lastReadRef.current = code === last.code ? { code, count: last.count + 1 } : { code, count: 1 }
          if (lastReadRef.current.count >= 2) {
            detectedRef.current = true
            stopStream() // release the camera immediately, don't wait for unmount
            props.onDetected(code)
          }
          // No-result frames throw NotFoundException via the err arg — ignored on purpose.
        }
      )
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
        Hold the barcode steady, fairly close, and well lit… If your phone asks about camera
        access, choose “While using the app” so it doesn’t ask every time.
      </p>
    </div>
  )
}
