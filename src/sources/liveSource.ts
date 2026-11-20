import type { Engine } from '../sim/engine'
import type { EngineNotice } from '../sim/types'
import type { EventSource as SimSource } from './types'

/**
 * Hoạt động thật do CLI đọc từ transcript Claude Code (xem server/transcripts.mjs).
 * Giao thức trung lập, không phụ thuộc engine 3D.
 */
export type Activity =
  | { type: 'prompt'; session: string; text: string }
  | { type: 'tool'; agent: string; tool: string; summary: string }
  | { type: 'delegate'; id: string; from: string; to: string; description: string }
  | { type: 'delegate_done'; id: string }
  | { type: 'turn_end'; session: string }
  | { type: 'status'; text: string }
  /** lịch sử gần nhất lúc mở (chỉ ghi nhật ký, không diễn lại) */
  | { type: 'history'; session: string; items: { at: number; a: Activity }[] }

interface Delegation {
  taskId: string
  to: string
  done: boolean
  returning: boolean
}

export const MAIN = 'main'

/**
 * Chuyển hoạt động thật → "kịch" cho engine:
 *  - prompt      → agent chính nhận việc mới (tiến độ tăng dần theo số lần gọi tool)
 *  - tool        → bong bóng "🔧 Edit layout.ts" trên đầu agent + đẩy tiến độ
 *  - delegate    → agent chính mang hồ sơ tới phòng subagent, subagent ngồi làm
 *  - delegate_done → subagent hoàn tất, mang kết quả về cho agent chính
 *  - turn_end    → agent chính trả lời xong yêu cầu
 */
export class ActivityMapper {
  private engine!: Engine
  private seq = 0
  private mainTask: string | null = null
  private readonly delegations = new Map<string, Delegation>()
  private readonly progress = new Map<string, number>()
  /** task đang làm của từng agent (để đẩy tiến độ khi agent gọi tool) */
  private readonly current = new Map<string, string>()
  private off?: () => void

  attach(engine: Engine) {
    this.engine = engine
    this.off = engine.onNotice((n) => this.onNotice(n))
  }

  detach() {
    this.off?.()
  }

  private has(agent: string) {
    return !!this.engine.agentById[agent]
  }

  handle(a: Activity) {
    const e = this.engine
    switch (a.type) {
      case 'prompt': {
        if (this.mainTask) e.dispatch({ type: 'task_done', taskId: this.mainTask })
        const id = `P${++this.seq}`
        this.mainTask = id
        this.progress.set(id, 0)
        this.current.set(MAIN, id)
        e.dispatch({ type: 'task_created', taskId: id, dept: MAIN, title: clip(a.text, 48) || 'Yêu cầu mới', workflow: 'Yêu cầu người dùng' })
        e.dispatch({ type: 'message', from: MAIN, text: `📥 ${clip(a.text, 70)}`, feed: false, seconds: 4 })
        break
      }
      case 'tool': {
        const who = this.has(a.agent) ? a.agent : MAIN
        e.dispatch({ type: 'message', from: who, text: `${toolIcon(a.tool)} ${clip(a.summary || a.tool, 46)}`, feed: true, seconds: 2.5 })
        const t = this.current.get(who)
        if (t) this.bump(t)
        break
      }
      case 'delegate': {
        if (!this.has(a.to)) {
          // agent không có phòng (vd plugin/agent cấp user chưa quét được): agent chính tự làm
          e.dispatch({ type: 'message', from: MAIN, text: `🤝 Giao "${a.to}": ${clip(a.description, 40)}`, seconds: 3 })
          return
        }
        const taskId = `D${++this.seq}`
        this.delegations.set(a.id, { taskId, to: a.to, done: false, returning: false })
        this.progress.set(taskId, 0)
        const from = this.has(a.from) ? a.from : MAIN
        e.dispatch({ type: 'task_created', taskId, dept: from, title: clip(a.description, 48) || a.to, workflow: `Giao việc cho ${a.to}` })
        e.dispatch({ type: 'handoff', taskId, from, to: a.to, title: clip(a.description, 48) || a.to, note: `Nhờ ${a.to}: ${clip(a.description, 40)}` })
        break
      }
      case 'delegate_done': {
        const d = this.delegations.get(a.id)
        if (!d || d.done) return
        d.done = true
        // đẩy tiến độ lên 100% → engine phát work_finished khi subagent "làm xong" → mang kết quả về
        e.dispatch({ type: 'task_progress', taskId: d.taskId, progress: 1 })
        break
      }
      case 'turn_end': {
        if (!this.mainTask) return
        e.dispatch({ type: 'task_progress', taskId: this.mainTask, progress: 1 })
        e.dispatch({ type: 'message', from: MAIN, text: '✅ Đã trả lời xong', feed: false, seconds: 3 })
        break
      }
      case 'status':
        break
      case 'history':
        this.loadHistory(a.items)
        break
    }
  }

  /** Ghi lịch sử vào nhật ký với giờ thật, không tạo hành động trong văn phòng */
  private loadHistory(items: { at: number; a: Activity }[]) {
    const e = this.engine
    const name = (id: string) => e.agentById[id]?.dept.name ?? id
    const own = (id: string) => (this.has(id) ? id : MAIN)
    const targets = new Map<string, { to: string; desc: string }>()
    for (const { at, a } of items) {
      switch (a.type) {
        case 'prompt':
          e.note(`📥 Yêu cầu: ${clip(a.text, 90)}`, 'task', MAIN, at)
          break
        case 'tool':
          e.note(`${name(own(a.agent))}: ${toolIcon(a.tool)} ${clip(a.summary || a.tool, 70)}`, 'info', own(a.agent), at)
          break
        case 'delegate':
          targets.set(a.id, { to: a.to, desc: a.description })
          e.note(`${name(own(a.from))} → ${a.to}: ${clip(a.description, 60)}`, 'handoff', own(a.from), at)
          break
        case 'delegate_done': {
          const t = targets.get(a.id)
          if (t) e.note(`${t.to} xong: ${clip(t.desc, 60)}`, 'done', own(t.to), at)
          break
        }
        case 'turn_end':
          e.note(`${name(MAIN)} trả lời xong`, 'done', MAIN, at)
          break
      }
    }
  }

  private bump(taskId: string) {
    const p = this.progress.get(taskId) ?? 0
    const next = Math.min(0.92, p + (1 - p) * 0.18)
    this.progress.set(taskId, next)
    this.engine.dispatch({ type: 'task_progress', taskId, progress: next })
  }

  private onNotice(n: EngineNotice) {
    const e = this.engine
    if (n.type === 'handoff_delivered') {
      // subagent nhận hồ sơ → bắt đầu làm; ghi nhận để đẩy tiến độ khi nó gọi tool
      for (const d of this.delegations.values()) {
        if (d.taskId !== n.taskId || d.returning) continue
        this.current.set(d.to, d.taskId)
        this.progress.set(d.taskId, 0)
        // subagent đã xong trước khi hồ sơ tới nơi (engine reset tiến độ khi bàn giao) → đánh dấu xong lại
        if (d.done) e.dispatch({ type: 'task_progress', taskId: d.taskId, progress: 1 })
      }
      return
    }
    if (n.type !== 'work_finished') return
    if (n.taskId === this.mainTask) {
      e.dispatch({ type: 'task_done', taskId: n.taskId })
      this.mainTask = null
      return
    }
    for (const [id, d] of this.delegations) {
      if (d.taskId !== n.taskId) continue
      if (!d.returning && n.dept === d.to) {
        // subagent xong → mang kết quả về agent chính (agent chính xem lại 2 giây)
        d.returning = true
        if (this.current.get(d.to) === d.taskId) this.current.delete(d.to)
        e.dispatch({ type: 'handoff', taskId: d.taskId, from: d.to, to: MAIN, title: `Kết quả: ${e.tasks.get(d.taskId)?.title ?? ''}`, effort: 2, note: '📄 Báo cáo kết quả' })
      } else if (d.returning) {
        e.dispatch({ type: 'task_done', taskId: d.taskId })
        this.delegations.delete(id)
      }
    }
  }
}

/** Nguồn sự kiện live: nhận Activity qua Server-Sent Events từ CLI */
export class LiveSource implements SimSource {
  readonly mapper = new ActivityMapper()
  private es?: globalThis.EventSource
  status: 'connecting' | 'live' | 'offline' = 'connecting'
  lastStatus = ''

  private readonly url: string

  constructor(url: string) {
    this.url = url
  }

  attach(engine: Engine) {
    this.mapper.attach(engine)
    this.connect()
  }

  private connect() {
    const es = new globalThis.EventSource(this.url)
    this.es = es
    es.onopen = () => (this.status = 'live')
    es.onerror = () => (this.status = 'offline') // EventSource tự kết nối lại
    es.onmessage = (m) => {
      try {
        const a = JSON.parse(m.data) as Activity
        if (a.type === 'status') this.lastStatus = a.text
        this.mapper.handle(a)
      } catch {
        /* bỏ qua dòng hỏng */
      }
    }
  }

  detach() {
    this.es?.close()
    this.mapper.detach()
  }
}

const clip = (s: string, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function toolIcon(tool: string) {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return '✏️'
  if (/^(Read)$/.test(tool)) return '📖'
  if (/^(Grep|Glob|ToolSearch)$/.test(tool)) return '🔎'
  if (/^(Bash|PowerShell|Monitor)$/.test(tool)) return '⌨️'
  if (/^(WebFetch|WebSearch)$/.test(tool)) return '🌐'
  if (/^mcp__/.test(tool)) return '🧩'
  return '🔧'
}
