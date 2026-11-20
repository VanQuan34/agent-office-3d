import type { Engine } from '../sim/engine'
import type { EngineNotice } from '../sim/types'
import type { EventSource as SimSource } from './types'

/**
 * Hoạt động thật do CLI đọc từ transcript (Claude Code: server/transcripts.mjs,
 * Antigravity CLI: server/antigravity.mjs). Giao thức trung lập, không phụ thuộc engine 3D.
 * `agent` bỏ trống = agent chính của Claude Code ('main').
 */
export type Activity =
  | { type: 'prompt'; session: string; text: string; agent?: string }
  | { type: 'tool'; agent: string; tool: string; summary: string; /** lệnh này khởi chạy agent khác (vd 'antigravity') */ launches?: string }
  | { type: 'delegate'; id: string; from: string; to: string; description: string }
  | { type: 'delegate_done'; id: string }
  | { type: 'turn_end'; session: string; agent?: string }
  | { type: 'status'; text: string }
  /** lịch sử gần nhất lúc mở (chỉ ghi nhật ký, không diễn lại) */
  | { type: 'history'; session: string; items: { at: number; a: Activity }[] }

interface Delegation {
  taskId: string
  from: string
  to: string
  done: boolean
  returning: boolean
}

export const MAIN = 'main'
/** Lệnh khởi chạy agent ngoài chỉ được ghép với prompt xuất hiện trong khoảng này */
const LAUNCH_WINDOW_MS = 10 * 60_000

/**
 * Chuyển hoạt động thật → "kịch" cho engine:
 *  - prompt        → agent nhận việc mới (agent chính, hoặc agent ngoài như Antigravity)
 *  - tool          → bong bóng "✏️ Edit layout.ts" trên đầu agent + đẩy tiến độ
 *  - delegate      → người giao mang hồ sơ tới phòng subagent, subagent ngồi làm
 *  - delegate_done → subagent hoàn tất, mang kết quả về cho người giao
 *  - turn_end      → agent trả lời xong yêu cầu
 * Nối agent ngoài: subagent chạy `agy …` (tool.launches) rồi Antigravity nhận prompt
 * → coi như subagent giao việc cho Antigravity; Antigravity trả lời xong → mang kết quả về.
 */
export class ActivityMapper {
  private engine!: Engine
  private seq = 0
  /** yêu cầu đang xử lý của từng agent (prompt người dùng) */
  private readonly requestTask = new Map<string, string>()
  private readonly delegations = new Map<string, Delegation>()
  private readonly progress = new Map<string, number>()
  /** task đang làm của từng agent (để đẩy tiến độ khi agent gọi tool) */
  private readonly current = new Map<string, string>()
  /** lệnh vừa khởi chạy agent ngoài, chờ ghép với prompt của agent đó */
  private pendingLaunch: { from: string; target: string; at: number } | null = null
  /** phiên của agent ngoài → id lần giao việc tương ứng */
  private readonly linkedSessions = new Map<string, string>()
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

  private own(agent: string | undefined) {
    return agent && this.has(agent) ? agent : MAIN
  }

  handle(a: Activity) {
    const e = this.engine
    switch (a.type) {
      case 'prompt': {
        const who = this.own(a.agent)
        const sessionKey = `${who}:${a.session}`
        const launch = this.pendingLaunch
        if (who !== MAIN && launch && launch.target === who && Date.now() - launch.at < LAUNCH_WINDOW_MS && !this.linkedSessions.has(sessionKey)) {
          // agent ngoài được một agent khác gọi → diễn như giao việc
          this.pendingLaunch = null
          const id = `L${++this.seq}`
          this.linkedSessions.set(sessionKey, id)
          this.startDelegation(id, launch.from, who, a.text)
          return
        }
        if (this.linkedSessions.has(sessionKey)) {
          e.dispatch({ type: 'message', from: who, text: `📥 ${clip(a.text, 70)}`, feed: true, seconds: 3 })
          return
        }
        const prev = this.requestTask.get(who)
        if (prev) e.dispatch({ type: 'task_done', taskId: prev })
        const id = `P${++this.seq}`
        this.requestTask.set(who, id)
        this.progress.set(id, 0)
        this.current.set(who, id)
        const title = clip(a.text, 48) || 'Yêu cầu mới'
        e.dispatch({ type: 'task_created', taskId: id, dept: who, title, workflow: 'Yêu cầu người dùng' })
        e.dispatch({ type: 'message', from: who, text: `📥 ${clip(a.text, 70)}`, feed: false, seconds: 4 })
        break
      }
      case 'tool': {
        const who = this.own(a.agent)
        e.dispatch({ type: 'message', from: who, text: `${toolIcon(a.tool)} ${clip(a.summary || a.tool, 46)}`, feed: true, seconds: 2.5 })
        const t = this.current.get(who)
        if (t) this.bump(t)
        if (a.launches && this.has(a.launches)) this.pendingLaunch = { from: who, target: a.launches, at: Date.now() }
        break
      }
      case 'delegate': {
        if (!this.has(a.to)) {
          // agent không có phòng (vd plugin/agent cấp user chưa quét được): người giao tự làm
          e.dispatch({ type: 'message', from: this.own(a.from), text: `🤝 Giao "${a.to}": ${clip(a.description, 40)}`, seconds: 3 })
          return
        }
        this.startDelegation(a.id, this.own(a.from), a.to, a.description)
        break
      }
      case 'delegate_done':
        this.finishDelegation(a.id)
        break
      case 'turn_end': {
        const who = this.own(a.agent)
        const linked = this.linkedSessions.get(`${who}:${a.session}`)
        if (linked) {
          this.linkedSessions.delete(`${who}:${a.session}`)
          this.finishDelegation(linked)
          return
        }
        const req = this.requestTask.get(who)
        if (!req) return
        e.dispatch({ type: 'task_progress', taskId: req, progress: 1 })
        e.dispatch({ type: 'message', from: who, text: '✅ Đã trả lời xong', feed: false, seconds: 3 })
        break
      }
      case 'status':
        break
      case 'history':
        this.loadHistory(a.items)
        break
    }
  }

  private startDelegation(id: string, from: string, to: string, description: string) {
    const e = this.engine
    const taskId = `D${++this.seq}`
    this.delegations.set(id, { taskId, from, to, done: false, returning: false })
    this.progress.set(taskId, 0)
    const title = clip(description, 48) || to
    const toName = e.agentById[to]?.dept.name ?? to
    e.dispatch({ type: 'task_created', taskId, dept: from, title, workflow: `Giao việc cho ${toName}` })
    e.dispatch({ type: 'handoff', taskId, from, to, title, note: `Nhờ ${toName}: ${clip(description, 40)}` })
  }

  private finishDelegation(id: string) {
    const d = this.delegations.get(id)
    if (!d || d.done) return
    d.done = true
    // đẩy tiến độ lên 100% → engine phát work_finished khi subagent "làm xong" → mang kết quả về
    this.engine.dispatch({ type: 'task_progress', taskId: d.taskId, progress: 1 })
  }

  /** Ghi lịch sử vào nhật ký với giờ thật, không tạo hành động trong văn phòng */
  private loadHistory(items: { at: number; a: Activity }[]) {
    const e = this.engine
    const name = (id: string) => e.agentById[id]?.dept.name ?? id
    const targets = new Map<string, { to: string; desc: string }>()
    for (const { at, a } of items) {
      switch (a.type) {
        case 'prompt': {
          const who = this.own(a.agent)
          e.note(`📥 ${who === MAIN ? 'Yêu cầu' : `Yêu cầu tới ${name(who)}`}: ${clip(a.text, 90)}`, 'task', who, at)
          break
        }
        case 'tool':
          e.note(`${name(this.own(a.agent))}: ${toolIcon(a.tool)} ${clip(a.summary || a.tool, 70)}`, 'info', this.own(a.agent), at)
          break
        case 'delegate':
          targets.set(a.id, { to: a.to, desc: a.description })
          e.note(`${name(this.own(a.from))} → ${a.to}: ${clip(a.description, 60)}`, 'handoff', this.own(a.from), at)
          break
        case 'delegate_done': {
          const t = targets.get(a.id)
          if (t) e.note(`${t.to} xong: ${clip(t.desc, 60)}`, 'done', this.own(t.to), at)
          break
        }
        case 'turn_end': {
          const who = this.own(a.agent)
          e.note(`${name(who)} trả lời xong`, 'done', who, at)
          break
        }
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
      // người nhận có hồ sơ → bắt đầu làm; ghi nhận để đẩy tiến độ khi nó gọi tool
      for (const d of this.delegations.values()) {
        if (d.taskId !== n.taskId || d.returning) continue
        this.current.set(d.to, d.taskId)
        this.progress.set(d.taskId, 0)
        // đã xong trước khi hồ sơ tới nơi (engine reset tiến độ khi bàn giao) → đánh dấu xong lại
        if (d.done) e.dispatch({ type: 'task_progress', taskId: d.taskId, progress: 1 })
      }
      return
    }
    if (n.type !== 'work_finished') return
    for (const [agent, req] of this.requestTask) {
      if (req !== n.taskId) continue
      e.dispatch({ type: 'task_done', taskId: n.taskId })
      this.requestTask.delete(agent)
      if (this.current.get(agent) === req) this.current.delete(agent)
      return
    }
    for (const [id, d] of this.delegations) {
      if (d.taskId !== n.taskId) continue
      if (!d.returning && n.dept === d.to) {
        // làm xong → mang kết quả về người đã giao (người giao xem lại 2 giây)
        d.returning = true
        if (this.current.get(d.to) === d.taskId) this.current.delete(d.to)
        e.dispatch({ type: 'handoff', taskId: d.taskId, from: d.to, to: d.from, title: `Kết quả: ${e.tasks.get(d.taskId)?.title ?? ''}`, effort: 2, note: '📄 Báo cáo kết quả' })
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
