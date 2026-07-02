// Renders public/favicon.svg to the PWA icons the manifest references
// (public/pwa-192.png, public/pwa-512.png). Run via `npm run icons`.
// Desktop (.ico) artwork is separate — see scripts/make-icon.js.
import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = join(root, 'public', 'favicon.svg')

for (const size of [192, 512]) {
  const out = join(root, 'public', `pwa-${size}.png`)
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out)
  console.log(`wrote ${out}`)
}
