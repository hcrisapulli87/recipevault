// Generate a Y4M "camera feed" of a synthetic EAN-13 for Chrome's
// --use-file-for-fake-video-capture. 640x480, 15fps, ~5s of identical frames.
const fs = require('fs')
const path = require('path')

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
const R = L.map((s) => [...s].map((c) => (c === '0' ? '1' : '0')).join(''))
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']

function ean13Modules(digits12) {
  const d = [...digits12].map(Number)
  const sum = d.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 1 : 3), 0)
  const all = [...d, (10 - (sum % 10)) % 10]
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (PARITY[all[0]][i - 1] === 'L' ? L : G)[all[i]]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[all[i]]
  console.log('encoded:', all.join(''))
  return bits + '101'
}

const W = 640, H = 480
const bits = ean13Modules('400638133393')
const moduleW = 5 // 95*5 = 475px wide
const bcW = bits.length * moduleW
const x0 = Math.floor((W - bcW) / 2)
const y0 = 140, y1 = 340

const Y = Buffer.alloc(W * H, 235) // white
for (let y = y0; y < y1; y++) {
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') Y.fill(16, y * W + x0 + i * moduleW, y * W + x0 + (i + 1) * moduleW)
  }
}
const U = Buffer.alloc((W / 2) * (H / 2), 128)
const V = Buffer.alloc((W / 2) * (H / 2), 128)

const frames = 75 // 5s @ 15fps
const out = fs.createWriteStream(path.join(__dirname, 'barcode.y4m'))
out.write(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`)
for (let f = 0; f < frames; f++) {
  out.write('FRAME\n')
  out.write(Y)
  out.write(U)
  out.write(V)
}
out.end(() => console.log('wrote barcode.y4m'))
