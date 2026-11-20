// Server HTTP tối giản: phục vụ bản build (dist/) + cấu hình + luồng Server-Sent Events.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
}

/**
 * @param {{ distDir: string, config: object, host?: string, port: number }} opts
 * @returns {Promise<{ url: string, broadcast: (a: object) => void, onFirstClient: Promise<void>, close: () => void }>}
 */
export function startServer({ distDir, config, host = '127.0.0.1', port }) {
  const clients = new Set()
  /** sự kiện đến trước khi trình duyệt kịp kết nối → giữ lại để gửi khi có client */
  let backlog = []
  let resolveFirst
  const onFirstClient = new Promise((r) => (resolveFirst = r))
  // đọc lại mỗi lần tải trang: build lại giao diện (tên file JS đổi) không làm hỏng server đang chạy
  const indexHtml = () =>
    fs
      .readFileSync(path.join(distDir, 'index.html'), 'utf8')
      .replace('<head>', `<head><script>window.__AGENT_OFFICE__=${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`)
  indexHtml() // báo lỗi sớm nếu chưa build

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write('retry: 2000\n\n')
      clients.add(res)
      for (const a of backlog) res.write(`data: ${JSON.stringify(a)}\n\n`)
      backlog = []
      resolveFirst()
      req.on('close', () => clients.delete(res))
      return
    }
    if (url.pathname === '/api/config') {
      res.writeHead(200, { 'Content-Type': TYPES['.json'] })
      res.end(JSON.stringify(config))
      return
    }
    // file tĩnh – chặn thoát ra ngoài thư mục dist
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '/index.html') {
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' })
      res.end(indexHtml())
      return
    }
    const file = path.resolve(distDir, '.' + rel)
    if (!file.startsWith(path.resolve(distDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'max-age=3600' })
    fs.createReadStream(file).pipe(res)
  })

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n')
  }, 15000)

  const broadcast = (a) => {
    if (!clients.size) {
      backlog.push(a)
      if (backlog.length > 200) backlog.shift()
      return
    }
    const line = `data: ${JSON.stringify(a)}\n\n`
    for (const c of clients) c.write(line)
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      resolve({
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${addr.port}/`,
        broadcast,
        onFirstClient,
        close: () => {
          clearInterval(heartbeat)
          for (const c of clients) c.end()
          server.close()
        },
      })
    })
  })
}
