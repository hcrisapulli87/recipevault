// Generates resources/icon.png (256x256) and resources/recipe-vault.ico from scratch —
// a warm orange rounded square with a white plate + fork/knife glyph drawn from primitives.
// Fresh artwork for THIS project: never copy icons between projects (Explorer caches by path).
const { deflateSync } = require('zlib')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const SIZE = 256
const px = new Uint8Array(SIZE * SIZE * 4)

const bg = [232, 148, 58] // --accent orange
const plate = [246, 242, 234]
const ring = [212, 124, 36]

function inRoundedSquare(x, y) {
  const r = 44
  const min = 8
  const max = SIZE - 9
  if (x < min || x > max || y < min || y > max) return false
  const cx = x < min + r ? min + r : x > max - r ? max - r : x
  const cy = y < min + r ? min + r : y > max - r ? max - r : y
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    if (!inRoundedSquare(x, y)) {
      px[i + 3] = 0
      continue
    }
    let c = bg
    const dx = x - 128
    const dy = y - 128
    const d2 = dx * dx + dy * dy
    if (d2 <= 78 * 78) c = plate // plate
    if (d2 <= 78 * 78 && d2 >= 70 * 70) c = ring // plate rim shadow
    if (d2 <= 30 * 30) c = ring // inner well
    if (d2 <= 26 * 26) c = plate
    // fork (left of plate): handle + 3 tines
    if (x >= 30 && x <= 36 && y >= 90 && y <= 180) c = plate
    for (const tx of [26, 32, 38]) {
      if (x >= tx - 1 && x <= tx + 1 && y >= 68 && y <= 92) c = plate
    }
    // knife (right of plate)
    if (x >= 220 && x <= 226 && y >= 90 && y <= 180) c = plate
    if (y >= 68 && y <= 92) {
      const w = ((y - 68) / 24) * 5 + 2
      if (x >= 223 - w && x <= 226) c = plate
    }
    px[i] = c[0]
    px[i + 1] = c[1]
    px[i + 2] = c[2]
    px[i + 3] = 255
  }
}

// raw PNG encode (one IDAT, filter 0 per scanline)
const crcTable = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

const dir = join(__dirname, '..', 'resources')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'icon.png'), png)

// ICO containing the PNG (valid PNG-compressed ICO entry)
const icoHeader = Buffer.alloc(6 + 16)
icoHeader.writeUInt16LE(0, 0) // reserved
icoHeader.writeUInt16LE(1, 2) // type: icon
icoHeader.writeUInt16LE(1, 4) // count
icoHeader[6] = 0 // width 256 → 0
icoHeader[7] = 0 // height 256 → 0
icoHeader.writeUInt16LE(1, 10) // color planes
icoHeader.writeUInt16LE(32, 12) // bpp
icoHeader.writeUInt32LE(png.length, 14)
icoHeader.writeUInt32LE(22, 18) // offset
writeFileSync(join(dir, 'recipe-vault.ico'), Buffer.concat([icoHeader, png]))

console.log('icon.png + recipe-vault.ico written')
