// Đọc hoạt động của Antigravity CLI (`agy`) → luồng Activity giống Claude Code.
//
// Cấu trúc thư mục (Antigravity CLI):
//   ~/.gemini/antigravity-cli/history.jsonl          { conversationId, workspace, timestamp, … } mỗi lượt chat
//   ~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl
//       mỗi dòng 1 bước: { step_index, source, type, status, created_at, content, tool_calls? }
//       USER_INPUT        → prompt (nội dung trong <USER_REQUEST>…</USER_REQUEST>)
//       PLANNER_RESPONSE  → tool_calls: [{ name, args }]; không có tool_calls = trả lời xong
//       GENERIC           → kết quả chạy tool
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const AGY_KEY = 'antigravity'

export const agyHome = (home = os.homedir()) => path.join(home, '.gemini', 'antigravity-cli')

const samePath = (a, b) => path.resolve(a).replace(/[\\/]+$/, '').toLowerCase() === path.resolve(b).replace(/[\\/]+$/, '').toLowerCase()

const readLines = (file) => {
  try {
    return fs
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
  } catch {
    return []
  }
}

/** Các hội thoại Antigravity của project: conversationId → thời điểm gần nhất (ms) */
export function agyConversationsFor(projectDir, agyDir = agyHome()) {
  const out = new Map()
  for (const h of readLines(path.join(agyDir, 'history.jsonl'))) {
    if (!h.conversationId || !h.workspace || !samePath(h.workspace, projectDir)) continue
    out.set(h.conversationId, Math.max(out.get(h.conversationId) ?? 0, Number(h.timestamp) || 0))
  }
  return out
}

export const agyTranscript = (agyDir, conv) => path.join(agyDir, 'brain', conv, '.system_generated', 'logs', 'transcript.jsonl')

/** Có nên đặt phòng cho Antigravity không: project từng dùng agy, hoặc agent của project nhắc tới agy */
export function wantsAntigravity(projectDir, roster, agyDir = agyHome()) {
  if (agyConversationsFor(projectDir, agyDir).size) return true
  return roster.some((a) => /\bagy\b|antigravity/i.test(`${a.key} ${a.description ?? ''}`))
}

export const AGY_ROSTER_ENTRY = {
  key: AGY_KEY,
  name: 'Antigravity',
  description: 'Antigravity CLI (agy) – agent ngoài, đọc từ ~/.gemini/antigravity-cli',
  color: '#4285f4',
  external: true,
}

/** Tóm tắt lời gọi tool của Antigravity cho bong bóng */
export function summarizeAgyTool(name, args = {}) {
  const base = (p) => (p ? path.basename(String(p)) : '')
  switch (name) {
    case 'read_file':
      return `Read ${base(args.Path)}`
    case 'write_file':
      return `Write ${base(args.Path)}`
    case 'edit_file':
      return `Edit ${base(args.Path)}`
    case 'run_command':
      return (args.toolSummary ? String(args.toolSummary).replace(/^["'\s]+|["'\s]+$/g, '') : '') || String(args.CommandLine ?? '').split('\n')[0].slice(0, 60)
    case 'search_web':
      return `Search "${String(args.query ?? '').slice(0, 40)}"`
    case 'manage_task':
      return `Task ${args.Action ?? ''}`
    case 'ask_question':
      return 'Hỏi người dùng'
    default:
      return name
  }
}

/** Đổi tên tool Antigravity sang tên quen thuộc để visualizer chọn biểu tượng */
const TOOL_ALIAS = { read_file: 'Read', write_file: 'Write', edit_file: 'Edit', run_command: 'Bash', search_web: 'WebSearch' }

export function agyPromptText(content) {
  const m = /<USER_REQUEST>([\s\S]*?)(<\/USER_REQUEST>|$)/i.exec(String(content ?? ''))
  const text = m ? m[1] : String(content ?? '')
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Dịch 1 bước transcript Antigravity → Activity[] (agent = 'antigravity').
 * `seen`: chống trùng khi cùng một bước được ghi lại nhiều lần (vd RUNNING rồi DONE).
 */
export function translateAgyStep(step, conv, seen) {
  const out = []
  if (!step || typeof step !== 'object') return out
  if (seen && step.step_index !== undefined && step.type !== 'GENERIC') {
    const key = `${conv}#${step.step_index}#${step.type}`
    if (seen.has(key)) return out
    if (step.status !== 'RUNNING') seen.add(key)
  }
  if (step.type === 'USER_INPUT') {
    const text = agyPromptText(step.content)
    if (text) out.push({ type: 'prompt', agent: AGY_KEY, session: conv, text })
  } else if (step.type === 'PLANNER_RESPONSE') {
    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : []
    for (const c of calls) {
      const name = String(c?.name ?? 'tool')
      out.push({ type: 'tool', agent: AGY_KEY, tool: TOOL_ALIAS[name] ?? name, summary: summarizeAgyTool(name, c?.args ?? {}) })
    }
    if (!calls.length && step.status !== 'RUNNING') out.push({ type: 'turn_end', agent: AGY_KEY, session: conv })
  }
  return out
}

const stepTime = (s) => Date.parse(s?.created_at ?? '') || 0

/** Dòng thời gian Activity của các hội thoại Antigravity trong khoảng [from, to] (ms) */
export function agyTimeline(projectDir, { from = 0, to = Infinity, agyDir = agyHome() } = {}) {
  const tl = []
  const seen = new Set()
  for (const conv of agyConversationsFor(projectDir, agyDir).keys()) {
    for (const s of readLines(agyTranscript(agyDir, conv))) {
      const t = stepTime(s)
      if (t < from || t > to) continue
      for (const a of translateAgyStep(s, conv, seen)) tl.push({ t, a })
    }
  }
  return tl.sort((x, y) => x.t - y.t)
}

/**
 * Theo dõi live: đọc history.jsonl để biết hội thoại nào thuộc project, rồi đọc phần ghi thêm
 * của transcript từng hội thoại (hội thoại có sẵn: từ cuối file; hội thoại mới: từ đầu).
 */
export class AgyWatcher extends EventEmitter {
  constructor(projectDir, { agyDir = agyHome(), pollMs = 500 } = {}) {
    super()
    this.projectDir = projectDir
    this.agyDir = agyDir
    this.pollMs = pollMs
    /** conv → { offset, buf } */
    this.files = new Map()
    this.seen = new Set()
  }

  start() {
    this.refresh(true)
    this.timer = setInterval(() => this.tick(), this.pollMs)
  }

  stop() {
    clearInterval(this.timer)
  }

  refresh(initial) {
    for (const conv of agyConversationsFor(this.projectDir, this.agyDir).keys()) {
      if (this.files.has(conv)) continue
      let size = 0
      try {
        size = fs.statSync(agyTranscript(this.agyDir, conv)).size
      } catch {
        /* transcript chưa được tạo */
      }
      this.files.set(conv, { offset: initial ? size : 0, buf: '' })
    }
  }

  tick() {
    this.refresh(false)
    for (const [conv, f] of this.files) {
      const file = agyTranscript(this.agyDir, conv)
      let st
      try {
        st = fs.statSync(file)
      } catch {
        continue
      }
      if (st.size < f.offset) f.offset = 0
      if (st.size === f.offset) continue
      const fd = fs.openSync(file, 'r')
      try {
        const b = Buffer.alloc(st.size - f.offset)
        fs.readSync(fd, b, 0, b.length, f.offset)
        f.offset = st.size
        const lines = (f.buf + b.toString('utf8')).split('\n')
        f.buf = lines.pop() ?? ''
        for (const l of lines) {
          if (!l.trim()) continue
          let s
          try {
            s = JSON.parse(l)
          } catch {
            continue
          }
          for (const a of translateAgyStep(s, conv, this.seen)) this.emit('activity', a)
        }
      } finally {
        fs.closeSync(fd)
      }
    }
  }
}
