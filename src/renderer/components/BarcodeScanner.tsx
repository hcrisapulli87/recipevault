import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  ChecksumException,
  DecodeHintType,
  FormatException
} from '@zxing/library'

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
 * The status line under the preview doubles as live feedback ("almost — hold
 * steady") and as a diagnostic: camera resolution + attempt counter + what the
 * decoder last saw, so a "won't scan" report pinpoints which layer is failing.
 *
 * Camera lifetime is kept as short as possible (the OS shows a recording indicator
 * the whole time the camera is held — that's the OS's own privacy feature): the
 * stream is stopped synchronously on the confirmed read, and teardown stops the
 * MediaStream tracks explicitly — zxing's reset() alone leaks the stream if the
 * component unmounts while the camera is still starting up.
 */
export function BarcodeScanner(props: { onDetected: (code: string) => void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectedRef = useRef(false)
  const lastReadRef = useRef<{ code: string; count: number }>({ code: '', count: 0 })
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [seen, setSeen] = useState<'nothing' | 'partial' | 'locking'>('nothing')

  useEffect(() => {
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E
    ])
    hints.set(DecodeHintType.TRY_HARDER, true)
    // zxing defaults to one decode attempt per 500ms — only ~2 chances/sec for a
    // checksum-valid read to land during the moments the camera has focus. A full
    // attempt on a blank 1080p frame measures ~50ms, so 100ms pacing is cheap and
    // gives real reads 10 chances/sec.
    const reader = new BrowserMultiFormatReader(hints, 100)
    reader.timeBetweenDecodingAttempts = 100
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
        (result, err) => {
          if (detectedRef.current) return
          setAttempts((n) => n + 1)
          if (!result) {
            // Checksum/format errors mean the decoder IS seeing barcode lines but
            // can't confirm the digits — one step from a read. NotFound means no
            // barcode pattern in the frame at all (too far / blurred / dark).
            if (err instanceof ChecksumException || err instanceof FormatException) {
              setSeen('partial')
            }
            return
          }
          // Two consecutive frames must agree before we trust the read.
          const code = result.getText()
          const last = lastReadRef.current
          lastReadRef.current = code === last.code ? { code, count: last.count + 1 } : { code, count: 1 }
          setSeen('locking')
          if (lastReadRef.current.count >= 2) {
            detectedRef.current = true
            stopStream() // release the camera immediately, don't wait for unmount
            props.onDetected(code)
          }
        }
      )
      // Resolves once the camera is attached; if we were torn down while it was
      // still opening, the cleanup below already ran, so stop the late stream here.
      .then(() => {
        if (cancelled) {
          stopStream()
          return
        }
        const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0]
        if (track) {
          const s = track.getSettings()
          setCamera(`${s.width}×${s.height}${s.facingMode ? ` · ${s.facingMode}` : ''}`)
          // Barcodes are scanned close up; ask for continuous autofocus where the
          // browser supports it (Android Chrome does). Best-effort — focusMode isn't
          // in the TS lib types and some devices reject it, hence the loose cast.
          track
            .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
            .catch(() => {})
        }
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

  const feedback =
    seen === 'locking'
      ? '✓ Reading it — hold still…'
      : seen === 'partial'
        ? 'Almost — barcode spotted, hold steady and let it focus…'
        : attempts > 20
          ? 'No barcode found yet — move closer (10–15 cm) and check the lighting.'
          : 'Point the barcode at the camera…'

  return (
    <div className="barcode-scanner">
      {/* playsInline keeps iOS from hijacking the preview into a fullscreen player */}
      <video ref={videoRef} className="barcode-scanner__video" autoPlay muted playsInline />
      <p className="barcode-scanner__hint">{feedback}</p>
      <p className="barcode-scanner__hint">
        {camera ? `camera ${camera} · ` : 'camera starting… · '}
        {attempts} scan attempts
      </p>
    </div>
  )
}
