// Tiny server: serves the harness page and records the browser's reports.
const http = require('http')
const fs = require('fs')
const path = require('path')

const page = `<!doctype html><html><body><video id="v" autoplay muted playsinline></video><script src="/harness.js"></script></body></html>`

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        fs.writeFileSync(path.join(__dirname, 'result.json'), body)
        res.end('ok')
      })
      return
    }
    if (req.url === '/harness.js') {
      res.setHeader('content-type', 'text/javascript')
      res.end(fs.readFileSync(path.join(__dirname, 'harness.js')))
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(page)
  })
  .listen(8123, () => console.log('listening on 8123'))
