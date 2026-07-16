import {
  BarcodeFormat,
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  FormatException,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  RGBLuminanceSource
} from '@zxing/library'

/**
 * Camera → decoder loop built directly on zxing's core, bypassing its browser
 * layer (BrowserMultiFormatReader / HTMLCanvasElementLuminanceSource).
 *
 * That layer is deprecated and has a fatal quirk: HTMLCanvasElementLuminanceSource
 * color-inverts every second buffer it creates via a GLOBAL static toggle (its way
 * of supporting inverted barcodes). With TRY_HARDER enabled, the rotated-image
 * retry creates a second buffer per attempt — two toggles — so the parity stops
 * alternating and can lock on "inverted": the decoder then sees an inverted
 * barcode on every frame, forever, and nothing ever scans. Verified against a
 * synthetic camera feed (test-scanner harness): stock pipeline 1/73 attempts,
 * this loop decodes reliably.
 *
 * Decoding is restricted to the retail formats (EAN/UPC — all food barcodes),
 * which carry a check digit; checksum-less formats like Code 39/ITF "succeed"
 * with garbage on blurry frames. Rotation (vertical barcode) is handled here by
 * decoding a transposed copy when the straight pass finds nothing.
 */

export type ScanStatus = 'nothing' | 'partial' | 'read'

export interface ScanLoop {
  stop: () => void
}

const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E
]

function makeReader(): MultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS)
  hints.set(DecodeHintType.TRY_HARDER, true)
  const reader = new MultiFormatReader()
  reader.setHints(hints as never)
  return reader
}

/** ITU-R integer luminance, same coefficients zxing uses internally. */
function toLuminance(rgba: Uint8ClampedArray, out: Uint8ClampedArray): void {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (306 * rgba[i] + 601 * rgba[i + 1] + 117 * rgba[i + 2] + 0x200) >> 10
  }
}

/** 90° rotation (transpose + reverse rows) so vertical barcodes still read. */
function rotate90(lum: Uint8ClampedArray, w: number, h: number, out: Uint8ClampedArray): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[x * h + (h - 1 - y)] = lum[y * w + x]
    }
  }
}

// ── native BarcodeDetector fast path ─────────────────────────────────────────
// Android Chrome ships a hardware-backed BarcodeDetector (the main scanning
// device is the phone PWA); desktop Chromium on Windows has no backend, so the
// zxing loop below stays the fallback. Not in the TS lib types — declared here.

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
interface NativeBarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

/** A native detector restricted to the retail formats, or null when the
 *  platform doesn't (fully) support the API. */
async function tryNativeDetector(): Promise<NativeBarcodeDetector | null> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorCtor }).BarcodeDetector
  if (!Ctor) return null
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? []
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f))
    if (!formats.includes('ean_13')) return null
    return new Ctor({ formats })
  } catch {
    return null
  }
}

/** Decode loop over the native detector. Reports 'nothing' when no code is in
 *  frame (the API has no 'partial' verdict). `onBroken` fires if detect() dies
 *  at runtime so the caller can swap in the zxing loop. */
function startNativeLoop(
  detector: NativeBarcodeDetector,
  video: HTMLVideoElement,
  intervalMs: number,
  onResult: (code: string | null, status: ScanStatus) => void,
  onBroken: () => void
): ScanLoop {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const attempt = async (): Promise<void> => {
    if (stopped) return
    if (video.readyState < 2 || video.videoWidth === 0) {
      timer = setTimeout(() => void attempt(), intervalMs)
      return
    }
    try {
      const codes = await detector.detect(video)
      if (stopped) return
      const hit = codes.find((c) => c.rawValue !== '')
      onResult(hit ? hit.rawValue : null, hit ? 'read' : 'nothing')
    } catch {
      // Backend exists but can't actually detect on this device.
      stopped = true
      onBroken()
      return
    }
    timer = setTimeout(() => void attempt(), intervalMs)
  }

  void attempt()
  return {
    stop: () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/**
 * Repeatedly grabs frames from `video` and tries to decode a retail barcode.
 * `onResult` fires for every attempt: a code string on success, otherwise the
 * decoder's verdict ('partial' = barcode lines seen but digits unconfirmed —
 * i.e. one steady frame away; 'nothing' = no pattern in frame).
 *
 * Prefers the native BarcodeDetector when the platform supports it (far less
 * CPU than the per-frame luminance + zxing pass); falls back to zxing
 * otherwise, or if the native path breaks at runtime.
 */
export function startScanLoop(
  video: HTMLVideoElement,
  intervalMs: number,
  onResult: (code: string | null, status: ScanStatus) => void
): ScanLoop {
  let inner: ScanLoop | null = null
  let stopped = false
  void tryNativeDetector().then((native) => {
    if (stopped) return
    inner = native
      ? startNativeLoop(native, video, intervalMs, onResult, () => {
          if (!stopped) inner = startZxingLoop(video, intervalMs, onResult)
        })
      : startZxingLoop(video, intervalMs, onResult)
  })
  return {
    stop: () => {
      stopped = true
      inner?.stop()
    }
  }
}

/** The zxing-based loop (see the header comment for why it bypasses zxing's browser layer). */
function startZxingLoop(
  video: HTMLVideoElement,
  intervalMs: number,
  onResult: (code: string | null, status: ScanStatus) => void
): ScanLoop {
  const reader = makeReader()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lum: Uint8ClampedArray = new Uint8ClampedArray(0)
  let rotated: Uint8ClampedArray = new Uint8ClampedArray(0)

  const decode = (buf: Uint8ClampedArray, w: number, h: number): string | null => {
    const source = new RGBLuminanceSource(buf, w, h)
    const result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source)))
    return result.getText()
  }

  const attempt = (): void => {
    if (stopped) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (!ctx || w === 0 || h === 0 || video.readyState < 2) {
      timer = setTimeout(attempt, intervalMs)
      return
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      lum = new Uint8ClampedArray(w * h)
      rotated = new Uint8ClampedArray(w * h)
    }
    ctx.drawImage(video, 0, 0, w, h)
    toLuminance(ctx.getImageData(0, 0, w, h).data, lum)

    let status: ScanStatus = 'nothing'
    try {
      onResult(decode(lum, w, h), 'read')
    } catch (e) {
      if (e instanceof ChecksumException || e instanceof FormatException) status = 'partial'
      // Straight pass failed — try the frame rotated 90° for vertical barcodes.
      if (e instanceof NotFoundException) {
        try {
          rotate90(lum, w, h, rotated)
          onResult(decode(rotated, h, w), 'read')
          status = 'read'
        } catch (e2) {
          if (e2 instanceof ChecksumException || e2 instanceof FormatException) status = 'partial'
        }
      }
      if (status !== 'read') onResult(null, status)
    }
    timer = setTimeout(attempt, intervalMs)
  }

  attempt()
  return {
    stop: () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
