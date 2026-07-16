import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { startScanLoop } from '../lib/barcodeDecoder'

/**
 * Live webcam barcode scanner. Calls onDetected once with the first confirmed code
 * (two agreeing reads). If the camera can't be opened it shows a note; the caller
 * still offers a typed barcode fallback, so this never blocks logging.
 *
 * Camera acquisition and the decode loop are our own (see lib/barcodeDecoder.ts
 * for why zxing's browser layer is unusable). The camera is held as briefly as
 * possible — the OS shows its recording indicator the whole time, by design —
 * and the stream is stopped synchronously on the confirmed read.
 */
export function BarcodeScanner(props: { onDetected: (code: string) => void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectedRef = useRef(false)
  const lastReadRef = useRef<{ code: string; count: number }>({ code: '', count: 0 })
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [seen, setSeen] = useState<'nothing' | 'partial' | 'locking'>('nothing')
  // Torch (flashlight) — pantry/cupboard scanning is often too dark to resolve
  // 1D line widths. Only offered when the track reports the capability
  // (phone back cameras; desktop webcams don't have one).
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const toggleTorch = (): void => {
    const next = !torchOn
    // torch isn't in the TS lib types (same story as focusMode) — loose cast.
    trackRef.current
      ?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorchOn(next))
      .catch(() => {})
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    let stream: MediaStream | null = null
    let loop: { stop: () => void } | null = null

    const stopAll = (): void => {
      loop?.stop()
      stream?.getTracks().forEach((t) => t.stop())
      if (video.srcObject) video.srcObject = null
    }

    navigator.mediaDevices
      // Back camera on phones (no-op on a desktop webcam); ask for a sharp feed —
      // 1D barcodes need resolvable line widths, and low-res defaults blur them.
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        video.srcObject = s
        const track = s.getVideoTracks()[0]
        trackRef.current = track ?? null
        // getCapabilities is missing on some engines (Firefox) — feature-detect.
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean }
        if (caps.torch) setTorchAvailable(true)
        const settings = track?.getSettings() ?? {}
        setCamera(
          `${settings.width}×${settings.height}${settings.facingMode ? ` · ${settings.facingMode}` : ''}`
        )
        // Barcodes are scanned close up; ask for continuous autofocus where the
        // browser supports it (Android Chrome does). Best-effort — focusMode isn't
        // in the TS lib types and some devices reject it, hence the loose cast.
        track
          ?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
          .catch(() => {})

        loop = startScanLoop(video, 100, (code, status) => {
          if (detectedRef.current) return
          setAttempts((n) => n + 1)
          if (code === null) {
            if (status === 'partial') setSeen('partial')
            return
          }
          // Two agreeing reads before we trust it (a different code resets the count).
          const last = lastReadRef.current
          lastReadRef.current = code === last.code ? { code, count: last.count + 1 } : { code, count: 1 }
          setSeen('locking')
          if (lastReadRef.current.count >= 2) {
            detectedRef.current = true
            stopAll() // release the camera immediately, don't wait for unmount
            props.onDetected(code)
          }
        })
      })
      .catch(() => {
        if (!cancelled) setError('Could not open the camera. Type the barcode below instead.')
      })

    return () => {
      cancelled = true
      stopAll()
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
      {torchAvailable && (
        <button className="btn" onClick={toggleTorch}>
          {torchOn ? '🔦 Torch off' : '🔦 Torch on'}
        </button>
      )}
      <p className="barcode-scanner__hint">{feedback}</p>
      <p className="barcode-scanner__hint">
        {camera ? `camera ${camera} · ` : 'camera starting… · '}
        {attempts} scan attempts
      </p>
    </div>
  )
}
