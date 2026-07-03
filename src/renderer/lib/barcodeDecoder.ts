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

/**
 * Repeatedly grabs frames from `video` and tries to decode a retail barcode.
 * `onResult` fires for every attempt: a code string on success, otherwise the
 * decoder's verdict ('partial' = barcode lines seen but digits unconfirmed —
 * i.e. one steady frame away; 'nothing' = no pattern in frame).
 */
export function startScanLoop(
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
