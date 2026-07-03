// End-to-end test of the app's REAL scan loop (src/renderer/lib/barcodeDecoder)
// against Chrome's fake camera. Reports every second to the local server.
import { startScanLoop } from '../src/renderer/lib/barcodeDecoder'

const report = {
  attempts: 0,
  nothing: 0,
  partial: 0,
  reads: [] as string[],
  video: '',
  cameraError: ''
}

function post(): void {
  void fetch('/result', { method: 'POST', body: JSON.stringify(report) }).catch(() => {})
}

const video = document.getElementById('v') as HTMLVideoElement

navigator.mediaDevices
  .getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
  })
  .then((s) => {
    video.srcObject = s
    startScanLoop(video, 100, (code, status) => {
      report.attempts++
      report.video = `${video.videoWidth}x${video.videoHeight}`
      if (code) report.reads.push(code)
      else if (status === 'partial') report.partial++
      else report.nothing++
    })
  })
  .catch((e) => {
    report.cameraError = String(e)
  })

setInterval(post, 1000)
