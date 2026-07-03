# Scanner test harness

End-to-end test of `src/renderer/lib/barcodeDecoder.ts` against a synthetic
camera: Chrome's fake video device plays a generated EAN-13 "feed" and the
harness reports decode results to a local server.

This rig is how we found that zxing's deprecated browser layer
(`HTMLCanvasElementLuminanceSource`) locks its global auto-invert parity when
TRY_HARDER is enabled — every frame decoded as color-inverted, so nothing ever
scanned. The app now bypasses that layer entirely (see `barcodeDecoder.ts`).

Usage (PowerShell, from the repo root):

```powershell
node test-scanner/gen-y4m.cjs                     # writes test-scanner/barcode.y4m
npx esbuild test-scanner/harness.ts --bundle --outfile=test-scanner/harness.js
Copy-Item test-scanner/barcode.y4m $env:TEMP/barcode.y4m   # Chrome flag chokes on spaces in paths
node test-scanner/server.cjs                      # serves :8123, writes result.json
# in another shell (path to y4m must have NO spaces):
chrome --headless=new --use-fake-device-for-media-stream `
  --use-file-for-fake-video-capture=C:\Users\HARRIS~1\AppData\Local\Temp\barcode.y4m `
  --use-fake-ui-for-media-stream --user-data-dir=$env:TEMP\chrome-scan-test http://localhost:8123
# after ~10s read test-scanner/result.json — expect readCount ≈ attempts, all 4006381333931
```

Generated artifacts (`harness.js`, `barcode.y4m`, `result.json`) are gitignored.
