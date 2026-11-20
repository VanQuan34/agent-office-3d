#!/usr/bin/env node
// agent-office – xem các agent Claude Code của project làm việc trong văn phòng 3D.
//
//   npx agent-office run [thư-mục-project] [--port 4317] [--replay] [--speed 4] [--session <id>] [--no-open]
//   npx agent-office agents [thư-mục-project]      liệt kê agent phát hiện được
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGY_ROSTER_ENTRY, AgyWatcher, agyConversationsFor, agyTimeline, wantsAntigravity } from '../server/antigravity.mjs'
import { buildRoster, findTranscriptDir } from '../server/discover.mjs'
import { startServer } from '../server/http.mjs'
import { latestSession, recentHistory, sessionTimeline, TranscriptWatcher } from '../server/transcripts.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(here, '..', 'dist')

function parseArgs(argv) {
  const args = { _: [], port: 4317, open: true, replay: false, speed: 4, session: null, help: false, agy: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('#')) break // phần còn lại là chú thích (cmd.exe không hiểu dấu #)
    if (a === '--port' || a === '-p') args.port = Number(argv[++i])
    else if (a === '--no-open') args.open = false
    else if (a === '--agy') args.agy = true
    else if (a === '--no-agy') args.agy = false
    else if (a === '--replay') args.replay = true
    else if (a === '--speed') args.speed = Number(argv[++i]) || 4
    else if (a === '--session') args.session = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
    else args._.push(a)
  }
  return args
}

const HELP = `
agent-office – văn phòng 3D cho các agent Claude Code (và Antigravity CLI) của project

Cách dùng:
  agent-office run [project]      Mở văn phòng 3D, theo dõi agent của project theo thời gian thực
  agent-office agents [project]   In danh sách agent phát hiện được

Tuỳ chọn cho "run":
  --port <số>        Cổng server local (mặc định 4317)
  --replay           Phát lại phiên gần nhất (có subagent) rồi tiếp tục theo dõi live
  --session <id>     Chọn phiên để phát lại
  --speed <n>        Tốc độ phát lại (mặc định 4x)
  --no-open          Không tự mở trình duyệt
  --agy / --no-agy   Bật / tắt phòng Antigravity CLI (mặc định: tự bật nếu project từng dùng agy)

[project] mặc định là thư mục hiện tại. Agent lấy từ .claude/agents/*.md và lịch sử transcript
trong ~/.claude/projects/; Antigravity CLI đọc từ ~/.gemini/antigravity-cli/.
Server chỉ lắng nghe trên 127.0.0.1, không gửi dữ liệu ra ngoài.
`

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
}

/** Ghép 2 dòng thời gian {t, a} theo thời gian */
const mergeTimelines = (...lists) => lists.flat().sort((x, y) => x.t - y.t)

async function replay(tl, label, speed, broadcast) {
  if (!tl.length) return 0
  broadcast({ type: 'status', text: `Phát lại ${label} (${tl.length} sự kiện)` })
  let prev = tl[0].t
  for (const { t, a } of tl) {
    // nén khoảng lặng: tối đa 3s thực, chia theo tốc độ
    const gap = Math.min(Math.max(t - prev, 0), 3000 * speed) / speed
    prev = t
    if (gap > 5) await new Promise((r) => setTimeout(r, gap))
    broadcast(a)
  }
  broadcast({ type: 'status', text: 'Phát lại xong – đang theo dõi live' })
  return tl.length
}

async function main() {
  const [cmd = 'run', ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)
  if (args.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP)
    return
  }
  const projectDir = path.resolve(args._[0] ?? process.cwd())
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    console.error(`Không tìm thấy thư mục project: ${projectDir}`)
    console.error('Chạy lệnh trong thư mục gốc của project, hoặc truyền đường dẫn: agent-office run D:\\duong-dan\\project')
    process.exitCode = 1
    return
  }
  const txDir = findTranscriptDir(projectDir)
  const roster = buildRoster(projectDir, { txDir })
  // Antigravity CLI: thêm phòng nếu project từng chạy agy (hoặc agent nào đó nhắc tới agy)
  const useAgy = args.agy ?? wantsAntigravity(projectDir, roster)
  if (useAgy) roster.push(AGY_ROSTER_ENTRY)

  if (cmd === 'agents') {
    console.log(`Project: ${projectDir}`)
    console.log(`Transcript: ${txDir ?? '(chưa có – project chưa từng chạy Claude Code?)'}`)
    for (const a of roster) console.log(`  • ${a.key.padEnd(28)} ${a.isMain ? '(agent chính)' : a.builtIn ? '(có sẵn)' : a.external ? '(agent ngoài)' : a.source ?? ''}  ${a.description ? '– ' + a.description.slice(0, 70) : ''}`)
    if (useAgy) console.log(`Antigravity: ${agyConversationsFor(projectDir).size} hội thoại của project này`)
    return
  }
  if (cmd !== 'run') {
    console.log(HELP)
    process.exitCode = 1
    return
  }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`Chưa có bản build giao diện (${DIST}). Chạy "npm run build" trong thư mục agent-office trước.`)
    process.exitCode = 1
    return
  }

  const config = {
    mode: args.replay ? 'replay' : 'live',
    project: { name: path.basename(projectDir), path: projectDir },
    agents: roster,
    eventsUrl: '/api/events',
  }
  const srv = await startServer({ distDir: DIST, config, port: args.port }).catch((e) => {
    if (e.code === 'EADDRINUSE') console.error(`Cổng ${args.port} đang bận. Dùng --port <số khác>.`)
    throw e
  })

  console.log(`\n  ◆ Agent Office – ${config.project.name}`)
  console.log(`    ${roster.length} agent: ${roster.map((a) => a.key).join(', ')}`)
  console.log(`    Transcript: ${txDir ?? 'chưa có – sẽ hiển thị khi Claude Code bắt đầu chạy trong project này'}`)
  if (useAgy) console.log(`    Antigravity CLI: ${agyConversationsFor(projectDir).size} hội thoại – theo dõi ~/.gemini/antigravity-cli`)
  console.log(`    Mở: ${srv.url}\n    Ctrl+C để dừng.\n`)
  if (args.open) openBrowser(srv.url)

  const watcher = new TranscriptWatcher(txDir)
  watcher.on('activity', (a) => srv.broadcast(a))
  const agyWatcher = useAgy ? new AgyWatcher(projectDir) : null
  agyWatcher?.on('activity', (a) => srv.broadcast(a))
  agyWatcher?.on('conversation', (id) => console.log(`    Antigravity: thấy hội thoại mới ${id.slice(0, 8)} – đang theo dõi.`))
  agyWatcher?.on('activity', (a) => a.type === 'prompt' && console.log(`    Antigravity nhận yêu cầu (${new Date().toLocaleTimeString('vi-VN')}).`))

  // nạp sẵn lịch sử gần nhất vào nhật ký (chế độ live): Claude Code + Antigravity, ghép theo giờ
  if (!args.replay) {
    // mỗi nguồn giữ phần gần nhất của riêng nó (Antigravity có thể cũ hơn Claude Code – không cắt mất)
    const claude = txDir ? (recentHistory(txDir)?.items ?? []) : []
    const agy = useAgy ? agyTimeline(projectDir).slice(-40).map(({ t, a }) => ({ at: t, a })) : []
    const items = [...claude, ...agy].sort((x, y) => x.at - y.at)
    if (items.length) {
      srv.broadcast({ type: 'history', session: 'recent', items })
      console.log(`    Nhật ký: nạp ${items.length} hoạt động gần nhất (Claude Code ${claude.length}, Antigravity ${agy.length}).`)
    }
  }

  if (args.replay) {
    const sid = txDir ? (args.session ?? latestSession(txDir)) : null
    let tl = sid ? sessionTimeline(txDir, sid) : []
    if (useAgy) {
      // các hội thoại Antigravity diễn ra trong khoảng thời gian của phiên (vd subagent gọi agy)
      const from = tl.length ? tl[0].t - 60_000 : 0
      const to = tl.length ? tl[tl.length - 1].t + 15 * 60_000 : Infinity
      const all = agyTimeline(projectDir)
      const inside = all.filter((x) => x.t >= from && x.t <= to)
      tl = mergeTimelines(tl, tl.length ? inside : inside.slice(-200))
      // hoạt động Antigravity ngoài đoạn phát lại (vd chat agy sau phiên Claude Code đó) → vẫn có trong nhật ký
      const replayed = new Set(tl.map((x) => x.a))
      const outside = all.filter((x) => !replayed.has(x.a)).slice(-40)
      if (outside.length) {
        srv.broadcast({ type: 'history', session: 'recent', items: outside.map(({ t, a }) => ({ at: t, a })) })
        console.log(`    Nhật ký: nạp ${outside.length} hoạt động Antigravity ngoài đoạn phát lại.`)
      }
    }
    if (tl.length) {
      await srv.onFirstClient
      await new Promise((r) => setTimeout(r, 1500)) // chờ cảnh 3D tải xong
      const n = await replay(tl, sid ? `phiên ${sid.slice(0, 8)}` : 'Antigravity', args.speed, srv.broadcast)
      console.log(`    Đã phát lại ${n} sự kiện${sid ? ` từ phiên ${sid}` : ''}.`)
    } else console.log('    Không tìm thấy phiên nào để phát lại.')
  }
  watcher.start()
  agyWatcher?.start()
  srv.broadcast({ type: 'status', text: txDir ? 'Đang theo dõi transcript' : 'Chưa có transcript' })

  // theo dõi thư mục transcript xuất hiện sau (project mới chạy Claude Code lần đầu)
  if (!txDir) {
    const t = setInterval(() => {
      const d = findTranscriptDir(projectDir)
      if (d) {
        clearInterval(t)
        watcher.txDir = d
        watcher.start()
        console.log(`    Đã thấy transcript: ${d}`)
      }
    }, 3000)
  }

  const stop = () => {
    watcher.stop()
    agyWatcher?.stop()
    srv.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((e) => {
  console.error(e?.message ?? e)
  process.exitCode = 1
})
