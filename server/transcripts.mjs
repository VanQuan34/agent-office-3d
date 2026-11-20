// Đọc transcript Claude Code (*.jsonl) → luồng Activity trung lập cho visualizer.
//
// Cấu trúc thư mục (Claude Code ≥ 2.x):
//   ~/.claude/projects/<project>/<sessionId>.jsonl                         ← agent chính
//   ~/.claude/projects/<project>/<sessionId>/subagents/agent-<id>.jsonl    ← từng subagent
//   ~/.claude/projects/<project>/<sessionId>/subagents/agent-<id>.meta.json  { agentType, toolUseId, finished }
//
// Activity: prompt | tool | delegate | delegate_done | turn_end | status (xem src/sources/liveSource.ts)
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

const DELEGATE_TOOLS = new Set(['Agent', 'Task'])

/** Tóm tắt lời gọi tool thành 1 dòng ngắn để hiện trong bong bóng */
export function summarizeTool(name, input = {}) {
  const base = (p) => (p ? path.basename(String(p)) : '')
  switch (name) {
    case 'Bash':
    case 'PowerShell': {
      if (input.description) return input.description
      // bỏ tiền tố "cd <thư mục> &&" cho gọn
      const cmd = String(input.command ?? '').split('\n')[0].replace(/^\s*(cd|Set-Location)\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/i, '')
      return cmd.slice(0, 60)
    }
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return `${name} ${base(input.file_path)}`
    case 'NotebookEdit':
      return `${name} ${base(input.notebook_path)}`
    case 'Grep':
      return `Grep "${String(input.pattern ?? '').slice(0, 40)}"`
    case 'Glob':
      return `Glob ${input.pattern ?? ''}`
    case 'WebFetch':
      try {
        return `Fetch ${new URL(input.url).hostname}`
      } catch {
        return 'WebFetch'
      }
    case 'WebSearch':
      return `Search "${String(input.query ?? '').slice(0, 40)}"`
    case 'Skill':
      return `Skill ${input.skill ?? ''}`
    case 'ToolSearch':
      return `ToolSearch ${input.query ?? ''}`
    default:
      if (name.startsWith('mcp__')) return name.split('__').slice(1).join(' › ')
      return name
  }
}

/** Lệnh shell có gọi Antigravity CLI (`agy …`) không */
export function launchesAgy(command) {
  const cmd = String(command ?? '')
  return /(^|[\s;&|("'`/\\])agy(\.exe|\.cmd|\.bat)?(?=\s|$|["'`)])/i.test(cmd) || /\bantigravity\b/i.test(cmd)
}

/** Lấy text người dùng gõ (bỏ system-reminder, khối lệnh nội bộ…) */
export function promptText(content) {
  let text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : ''
  text = text.replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Bộ dịch trạng thái: nhớ các lời gọi Agent đang chờ để ghép với kết quả.
 * `who` = 'main' cho file phiên chính, = agentType cho file subagent.
 */
export class Translator {
  constructor() {
    /** toolUseId → { async: boolean, done: boolean } */
    this.pending = new Map()
    this.endedMessages = new Set()
  }

  /** @returns {Array<object>} các Activity sinh ra từ 1 dòng transcript */
  translate(e, who) {
    const out = []
    if (!e || typeof e !== 'object') return out
    const content = e.message?.content
    if (e.type === 'user') {
      const parts = Array.isArray(content) ? content : []
      const results = parts.filter((p) => p.type === 'tool_result')
      for (const r of results) {
        const p = this.pending.get(r.tool_use_id)
        if (!p || p.done) continue
        const res = e.toolUseResult
        if (res && typeof res === 'object' && (res.status === 'async_launched' || res.isAsync)) p.async = true
        else {
          p.done = true
          out.push({ type: 'delegate_done', id: r.tool_use_id })
        }
      }
      // chỉ lấy prompt thật của người dùng ở phiên chính
      if (who === 'main' && !results.length && !e.isMeta && !e.isSidechain && e.promptSource !== 'system') {
        const text = promptText(content)
        if (text) out.push({ type: 'prompt', session: e.sessionId ?? '', text })
      }
    } else if (e.type === 'assistant' && Array.isArray(content)) {
      let usedTool = false
      for (const p of content) {
        if (p.type !== 'tool_use') continue
        usedTool = true
        if (DELEGATE_TOOLS.has(p.name)) {
          if (this.pending.has(p.id)) continue
          this.pending.set(p.id, { async: false, done: false })
          out.push({ type: 'delegate', id: p.id, from: who, to: p.input?.subagent_type || 'general-purpose', description: p.input?.description || '' })
        } else {
          const a = { type: 'tool', agent: who, tool: p.name, summary: summarizeTool(p.name, p.input) }
          // lệnh shell gọi Antigravity CLI → visualizer nối sang phòng Antigravity
          if ((p.name === 'Bash' || p.name === 'PowerShell') && launchesAgy(p.input?.command)) a.launches = 'antigravity'
          out.push(a)
        }
      }
      const stop = e.message?.stop_reason
      const mid = e.message?.id ?? e.uuid
      if (who === 'main' && !usedTool && (stop === 'end_turn' || stop === 'stop_sequence') && !this.endedMessages.has(mid)) {
        this.endedMessages.add(mid)
        out.push({ type: 'turn_end', session: e.sessionId ?? '' })
      }
    }
    return out
  }

  /** subagent chạy nền đã xong (meta.finished) */
  finish(toolUseId) {
    const p = this.pending.get(toolUseId)
    if (!p || p.done) return null
    p.done = true
    return { type: 'delegate_done', id: toolUseId }
  }

  isWaitingAsync(toolUseId) {
    const p = this.pending.get(toolUseId)
    return !!p && p.async && !p.done
  }
}

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Theo dõi live: đọc phần ghi thêm của các file transcript (polling – ổn định trên Windows).
 * Lúc khởi động chỉ đọc từ cuối file (không phát lại lịch sử); file tạo sau đó đọc từ đầu.
 */
export class TranscriptWatcher extends EventEmitter {
  constructor(txDir, { pollMs = 400, activeWithinMs = 12 * 3600_000 } = {}) {
    super()
    this.txDir = txDir
    this.pollMs = pollMs
    this.activeWithinMs = activeWithinMs
    this.translator = new Translator()
    /** file → { offset, buf, who, meta } */
    this.files = new Map()
    this.started = false
  }

  start() {
    if (!this.txDir) return
    this.scan(true)
    this.started = true
    this.timer = setInterval(() => this.tick(), this.pollMs)
  }

  stop() {
    clearInterval(this.timer)
  }

  /** Tìm file phiên chính + file subagent */
  scan(initial = false) {
    const now = Date.now()
    let entries = []
    try {
      entries = fs.readdirSync(this.txDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of entries) {
      const full = path.join(this.txDir, d.name)
      if (d.isFile() && d.name.endsWith('.jsonl')) {
        this.track(full, 'main', null, initial, now)
      } else if (d.isDirectory()) {
        const sub = path.join(full, 'subagents')
        if (!fs.existsSync(sub)) continue
        for (const f of fs.readdirSync(sub)) {
          if (!f.endsWith('.jsonl')) continue
          const metaFile = path.join(sub, f.replace(/\.jsonl$/, '.meta.json'))
          this.track(path.join(sub, f), null, metaFile, initial, now)
        }
      }
    }
  }

  track(file, who, metaFile, initial, now) {
    if (this.files.has(file)) return
    let st
    try {
      st = fs.statSync(file)
    } catch {
      return
    }
    // File có sẵn lúc khởi động: bắt đầu từ cuối (kể cả file cũ – nếu bỏ qua, lượt quét sau sẽ coi
    // là file mới và đọc lại từ đầu → phát lại lịch sử như hoạt động live). File tạo sau: đọc từ đầu.
    // Phiên cũ tạo trước khi CLI chạy nhưng vẫn mở và được ghi thêm sau đó cũng được theo dõi.
    void now
    this.files.set(file, { offset: initial ? st.size : 0, buf: '', who, metaFile, meta: null })
  }

  tick() {
    this.scan(false)
    for (const [file, f] of this.files) {
      if (!f.who && f.metaFile) {
        f.meta = f.meta ?? readJson(f.metaFile)
        if (!f.meta) continue // chờ meta.json xuất hiện để biết agentType
        f.who = f.meta.agentType || 'general-purpose'
      }
      this.readNew(file, f)
      // subagent chạy nền: theo dõi cờ finished trong meta.json
      if (f.metaFile && f.meta?.toolUseId && this.translator.isWaitingAsync(f.meta.toolUseId)) {
        const meta = readJson(f.metaFile)
        if (meta?.finished) {
          f.meta = meta
          const a = this.translator.finish(meta.toolUseId)
          if (a) this.emit('activity', a)
        }
      }
    }
  }

  readNew(file, f) {
    let st
    try {
      st = fs.statSync(file)
    } catch {
      return
    }
    if (st.size < f.offset) f.offset = 0 // file bị ghi lại
    if (st.size === f.offset) return
    const fd = fs.openSync(file, 'r')
    try {
      const len = st.size - f.offset
      const b = Buffer.alloc(len)
      fs.readSync(fd, b, 0, len, f.offset)
      f.offset = st.size
      const text = f.buf + b.toString('utf8')
      const lines = text.split('\n')
      f.buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let e
        try {
          e = JSON.parse(line)
        } catch {
          continue
        }
        for (const a of this.translator.translate(e, f.who)) this.emit('activity', a)
      }
    } finally {
      fs.closeSync(fd)
    }
  }
}

/** Hoạt động gần nhất của phiên mới nhất – để nhật ký không trống khi vừa mở */
export function recentHistory(txDir, limit = 60) {
  const sid = latestSession(txDir, { withSubagents: false })
  if (!sid) return null
  const items = sessionTimeline(txDir, sid)
    .slice(-limit)
    .map(({ t, a }) => ({ at: t, a }))
  return { type: 'history', session: sid, items }
}

/** Phiên gần nhất (ưu tiên phiên có subagent) */
export function latestSession(txDir, { withSubagents = true } = {}) {
  if (!txDir) return null
  const mains = fs
    .readdirSync(txDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ id: f.replace(/\.jsonl$/, ''), t: fs.statSync(path.join(txDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  const pick = withSubagents ? mains.find((m) => fs.existsSync(path.join(txDir, m.id, 'subagents'))) : null
  return (pick ?? mains[0])?.id ?? null
}

const lines = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)

/**
 * Dựng dòng thời gian Activity của một phiên đã qua (phiên chính + mọi subagent), sắp theo thời gian.
 * @returns {Array<{t:number, a:object}>}
 */
export function sessionTimeline(txDir, sessionId) {
  const tr = new Translator()
  const timeline = []
  const ts = (e) => Date.parse(e.timestamp ?? '') || 0
  // gom mọi dòng (chính + subagent) rồi dịch theo thứ tự thời gian để ghép kết quả đúng
  const all = lines(path.join(txDir, `${sessionId}.jsonl`)).map((e) => ({ e, who: 'main' }))
  const sub = path.join(txDir, sessionId, 'subagents')
  const metas = []
  if (fs.existsSync(sub)) {
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith('.jsonl'))) {
      const meta = readJson(path.join(sub, f.replace(/\.jsonl$/, '.meta.json'))) ?? {}
      const es = lines(path.join(sub, f))
      for (const e of es) all.push({ e, who: meta.agentType || 'general-purpose' })
      if (meta.toolUseId && es.length) metas.push({ id: meta.toolUseId, end: ts(es[es.length - 1]) + 500, finished: meta.finished !== false })
    }
  }
  all.sort((x, y) => ts(x.e) - ts(y.e))
  for (const { e, who } of all) for (const a of tr.translate(e, who)) timeline.push({ t: ts(e), a })
  // subagent chạy nền: kết thúc ở dòng cuối của file subagent
  for (const m of metas) {
    if (!tr.isWaitingAsync(m.id) || !m.finished) continue
    const a = tr.finish(m.id)
    if (a) timeline.push({ t: m.end, a })
  }
  return timeline.sort((x, y) => x.t - y.t)
}
