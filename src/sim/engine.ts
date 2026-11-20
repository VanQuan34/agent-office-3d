import {
  ACTIVITY_SPOTS,
  BOUNDS,
  DEPARTMENTS,
  DEPT_BY_ID,
  MEETING_SEATS,
  obstacleRects,
  type ActivitySpot,
  type Department,
  type SpotKind,
} from './layout'
import { NavGrid } from './navgrid'
import type { AnimState, DeptId, EngineNotice, FeedItem, FeedKind, SimEvent, Spot, Vec2 } from './types'

export const WALK_SPEED = 1.35 // m/s

// ---------------------------------------------------------------- model

export interface Task {
  id: string
  title: string
  dept: DeptId
  workflow?: string
  /** số giây mô phỏng cần để xong; undefined = tiến độ do nguồn bên ngoài báo */
  effort?: number
  progress: number
  status: 'queued' | 'working' | 'waiting' | 'transit' | 'done'
  createdAt: number
}

export interface Meeting {
  id: string
  topic: string
  participants: DeptId[]
  seats: Partial<Record<DeptId, Spot>>
  duration: number
  createdAt: number
  arrived: Set<DeptId>
  startedAt: number | null
  endsAt: number
  ended: boolean
  speaker: DeptId | null
  nextSpeakAt: number
}

type Job =
  | { kind: 'handoff'; taskId: string; to: DeptId; title?: string; effort?: number; note?: string }
  | { kind: 'meeting'; meetingId: string }

type Action =
  | { kind: 'goto'; target: Vec2; heading?: number; activity?: string; path?: Vec2[] }
  | { kind: 'sit'; seat: Spot; at: 'desk' | 'meeting' }
  | { kind: 'work'; taskId: string }
  | { kind: 'pose'; anim: AnimState; duration: number; activity?: string; bubble?: string; until?: number }
  | { kind: 'meeting'; meetingId: string }
  | { kind: 'call'; fn: (a: Agent) => void }

export interface Agent {
  id: DeptId
  dept: Department
  pos: Vec2
  heading: number
  anim: AnimState
  seatedAt: 'desk' | 'meeting' | null
  carrying: boolean
  plan: Action[]
  planKind: 'idle' | 'job'
  jobs: Job[]
  backlog: string[]
  activity: string
  bubble: { text: string; until: number } | null
  currentTaskId: string | null
  reservedSpot: string | null
}

export interface ExchangeFx {
  id: number
  from: DeptId
  to: DeptId
  until: number
}

const MEETING_LINES = [
  'Tiến độ bên mình đang ổn.',
  'Mình cần thêm số liệu tuần này.',
  'Đề xuất ưu tiên khách hàng lớn.',
  'Bên mình sẽ hỗ trợ phần này.',
  'Rủi ro chính nằm ở timeline.',
  'Đồng ý, chốt phương án này nhé.',
  'Cần thống nhất ngân sách trước.',
  'Mình sẽ gửi báo cáo sau buổi họp.',
]

// ---------------------------------------------------------------- engine

export class Engine {
  time = 0
  readonly nav: NavGrid
  readonly agents: Agent[]
  readonly agentById: Record<DeptId, Agent>
  readonly tasks = new Map<string, Task>()
  readonly meetings = new Map<string, Meeting>()
  readonly feed: FeedItem[] = []
  readonly fx: ExchangeFx[] = []
  completedCount = 0

  private pendingMeetings: Meeting[] = []
  private spotOwner = new Map<string, DeptId>()
  private listeners = new Set<(n: EngineNotice) => void>()
  private feedSeq = 0
  private fxSeq = 0
  private rand: () => number

  /** chế độ live: nhật ký đóng dấu giờ thật */
  realTime = false

  constructor(opts: { random?: () => number; realTime?: boolean } = {}) {
    this.realTime = opts.realTime ?? false
    this.rand = opts.random ?? Math.random
    this.nav = new NavGrid({ ...BOUNDS, cell: 0.5, radius: 0.35 }, obstacleRects())
    this.agents = DEPARTMENTS.map((d) => ({
      id: d.id,
      dept: d,
      pos: { x: d.seat.x, z: d.seat.z },
      heading: d.seat.heading,
      anim: 'type' as AnimState,
      seatedAt: 'desk' as const,
      carrying: false,
      plan: [],
      planKind: 'idle' as const,
      jobs: [],
      backlog: [],
      activity: 'Làm việc tại bàn',
      bubble: null,
      currentTaskId: null,
      reservedSpot: null,
    }))
    this.agentById = Object.fromEntries(this.agents.map((a) => [a.id, a])) as Record<DeptId, Agent>
  }

  onNotice(fn: (n: EngineNotice) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // ------------------------------------------------------------ input

  dispatch(ev: SimEvent) {
    switch (ev.type) {
      case 'task_created': {
        const task: Task = {
          id: ev.taskId,
          title: ev.title,
          dept: ev.dept,
          workflow: ev.workflow,
          effort: ev.effort,
          progress: 0,
          status: 'queued',
          createdAt: this.time,
        }
        if (!this.agentById[ev.dept]) return // agent không có trong văn phòng
        this.tasks.set(task.id, task)
        this.agentById[ev.dept].backlog.push(task.id)
        this.log(`${DEPT_BY_ID[ev.dept].name} nhận việc mới: ${ev.title}`, 'task', ev.dept)
        break
      }
      case 'task_progress': {
        const t = this.tasks.get(ev.taskId)
        if (t) {
          t.effort = undefined // nguồn ngoài điều khiển tiến độ
          t.progress = Math.min(1, Math.max(0, ev.progress))
        }
        break
      }
      case 'handoff': {
        const t = this.tasks.get(ev.taskId)
        if (!t || !this.agentById[ev.from] || !this.agentById[ev.to]) return
        if (ev.from === ev.to) {
          this.assignTask(t, ev.to, ev.title, ev.effort)
          return
        }
        t.status = 'transit'
        this.agentById[ev.from].jobs.push({
          kind: 'handoff',
          taskId: ev.taskId,
          to: ev.to,
          title: ev.title,
          effort: ev.effort,
          note: ev.note,
        })
        break
      }
      case 'meeting': {
        const m: Meeting = {
          id: ev.meetingId,
          topic: ev.topic,
          participants: [...new Set(ev.participants)].slice(0, MEETING_SEATS.length),
          seats: {},
          duration: ev.duration ?? 25,
          createdAt: this.time,
          arrived: new Set(),
          startedAt: null,
          endsAt: Infinity,
          ended: false,
          speaker: null,
          nextSpeakAt: 0,
        }
        m.participants.forEach((p, i) => (m.seats[p] = MEETING_SEATS[i]))
        const busy = this.activeMeeting() // chỉ 1 phòng họp → họp sau phải xếp hàng
        this.meetings.set(m.id, m)
        if (busy) this.pendingMeetings.push(m)
        else this.openMeeting(m)
        break
      }
      case 'message': {
        const a = this.agentById[ev.from]
        if (!a) return
        this.say(a, ev.text, ev.seconds ?? 4)
        if (ev.feed !== false) this.log(`${DEPT_BY_ID[ev.from].name}: ${ev.text}`, 'info', ev.from)
        break
      }
      case 'task_done': {
        const t = this.tasks.get(ev.taskId)
        if (!t) return
        t.status = 'done'
        this.completedCount++
        this.say(this.agentById[t.dept], '✅ Hoàn tất!', 3)
        this.log(`Hoàn tất quy trình "${t.workflow ?? t.title}"`, 'done', t.dept)
        this.tasks.delete(t.id)
        break
      }
    }
  }

  // ------------------------------------------------------------ tick

  update(dt: number) {
    this.time += dt
    this.updateMeetings()
    for (const a of this.agents) this.updateAgent(a, dt)
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i].until < this.time) this.fx.splice(i, 1)
  }

  private updateAgent(a: Agent, dt: number) {
    if (a.bubble && a.bubble.until < this.time) a.bubble = null

    // việc chưa rõ thời lượng (nguồn ngoài báo tiến độ) nhường chỗ cho việc giao/họp đang chờ:
    // vd agent chính đang xử lý yêu cầu mà gọi subagent → đứng dậy mang hồ sơ đi ngay
    const cur = a.plan[0]
    if (a.jobs.length && cur?.kind === 'work') {
      const t = this.tasks.get(cur.taskId)
      if (t && t.effort === undefined && t.status === 'working') {
        t.status = 'queued'
        a.backlog.unshift(t.id)
        a.currentTaskId = null
        a.plan = []
      }
    }

    // việc ưu tiên chen ngang hành vi rảnh rỗi
    if (a.planKind === 'idle' || a.plan.length === 0) {
      const planned = this.planJob(a)
      if (!planned && a.plan.length === 0) this.planIdle(a)
    }

    // chạy hành động; hành động tức thời được xử lý liên tiếp trong cùng tick
    for (let guard = 0; guard < 8 && a.plan.length; guard++) {
      if (!this.runAction(a, a.plan[0], dt)) break
      a.plan.shift()
    }
  }

  /** @returns true nếu action đã xong */
  private runAction(a: Agent, act: Action, dt: number): boolean {
    switch (act.kind) {
      case 'goto': {
        if (!act.path) {
          a.seatedAt = null
          if (act.activity) a.activity = act.activity
          act.path = this.nav.findPath(a.pos, act.target) ?? [act.target]
        }
        a.anim = a.carrying ? 'carry' : 'walk'
        let step = WALK_SPEED * dt
        while (step > 0 && act.path.length) {
          const p = act.path[0]
          const dx = p.x - a.pos.x
          const dz = p.z - a.pos.z
          const d = Math.hypot(dx, dz)
          if (d > 1e-4) a.heading = Math.atan2(dx, dz)
          if (d <= step) {
            a.pos.x = p.x
            a.pos.z = p.z
            step -= d
            act.path.shift()
          } else {
            a.pos.x += (dx / d) * step
            a.pos.z += (dz / d) * step
            step = 0
          }
        }
        if (act.path.length) return false
        if (act.heading !== undefined) a.heading = act.heading
        a.anim = 'idle'
        return true
      }
      case 'sit': {
        a.pos.x = act.seat.x
        a.pos.z = act.seat.z
        a.heading = act.seat.heading
        a.seatedAt = act.at
        a.anim = 'sit'
        return true
      }
      case 'work': {
        const t = this.tasks.get(act.taskId)
        if (!t || t.status === 'done' || t.dept !== a.id) {
          a.currentTaskId = null
          return true
        }
        if (t.status === 'queued') {
          t.status = 'working'
          this.log(`${a.dept.agentName} (${a.dept.name}) bắt đầu: ${t.title}`, 'task', a.id)
        }
        a.currentTaskId = t.id
        a.activity = `Đang xử lý: ${t.title}`
        a.anim = 'type'
        if (t.effort !== undefined) t.progress = Math.min(1, t.progress + dt / t.effort)
        if (t.progress < 1) return false
        t.status = 'waiting'
        a.currentTaskId = null
        this.say(a, '✔ Xong phần việc!', 2.5)
        this.log(`${a.dept.name} hoàn thành: ${t.title}`, 'task', a.id)
        this.emit({ type: 'work_finished', taskId: t.id, dept: a.id })
        return true
      }
      case 'pose': {
        if (act.until === undefined) {
          act.until = this.time + act.duration
          if (act.activity) a.activity = act.activity
          if (act.bubble) this.say(a, act.bubble, Math.min(act.duration, 4))
        }
        a.anim = act.anim
        return this.time >= act.until
      }
      case 'meeting': {
        const m = this.meetings.get(act.meetingId)
        if (!m || m.ended) return true
        m.arrived.add(a.id)
        a.activity = m.startedAt === null ? `Chờ họp: ${m.topic}` : `Đang họp: ${m.topic}`
        a.anim = m.speaker === a.id ? 'sitTalk' : 'sit'
        return false
      }
      case 'call':
        act.fn(a)
        return true
    }
  }

  // ------------------------------------------------------------ lập kế hoạch

  private gotoDesk(a: Agent, activity = 'Về bàn làm việc'): Action[] {
    if (a.seatedAt === 'desk') return []
    return [
      { kind: 'goto', target: a.dept.seat, activity },
      { kind: 'sit', seat: a.dept.seat, at: 'desk' },
    ]
  }

  private planJob(a: Agent): boolean {
    let job: Job | undefined
    const mi = a.jobs.findIndex((j) => j.kind === 'meeting')
    if (mi >= 0) job = a.jobs.splice(mi, 1)[0]
    else if (a.jobs.length) job = a.jobs.shift()

    if (job?.kind === 'meeting') {
      const m = this.meetings.get(job.meetingId)
      const seat = m?.seats[a.id]
      if (!m || m.ended || !seat) return false
      this.setPlan(a, 'job', [
        { kind: 'goto', target: seat, activity: `Đi họp: ${m.topic}` },
        { kind: 'sit', seat, at: 'meeting' },
        { kind: 'meeting', meetingId: m.id },
      ])
      return true
    }

    if (job?.kind === 'handoff') {
      const t = this.tasks.get(job.taskId)
      if (!t) return false
      const target = DEPT_BY_ID[job.to]
      const j = job
      this.setPlan(a, 'job', [
        { kind: 'call', fn: (ag) => (ag.carrying = true) },
        { kind: 'goto', target: target.guest, heading: target.guest.heading, activity: `Mang hồ sơ tới ${target.name}` },
        {
          kind: 'pose',
          anim: 'talk',
          duration: 2.5,
          bubble: j.note ?? `Gửi ${target.name}: "${t.title}"`,
        },
        { kind: 'call', fn: (ag) => this.deliver(ag, t, j) },
      ])
      return true
    }

    // việc trong backlog
    while (a.backlog.length) {
      const id = a.backlog[0]
      const t = this.tasks.get(id)
      if (!t || t.dept !== a.id || t.status === 'done' || t.status === 'transit' || t.status === 'waiting') {
        a.backlog.shift()
        continue
      }
      a.backlog.shift()
      this.setPlan(a, 'job', [...this.gotoDesk(a, `Về bàn xử lý: ${t.title}`), { kind: 'work', taskId: t.id }])
      return true
    }
    return false
  }

  private planIdle(a: Agent) {
    if (a.seatedAt !== 'desk') {
      this.setPlan(a, 'idle', [...this.gotoDesk(a), this.idleWork()])
      return
    }
    const r = this.rand()
    let kind: SpotKind | null = null
    if (r < 0.6) kind = null
    else if (r < 0.8) kind = 'coffee'
    else if (r < 0.9) kind = 'printer'
    else kind = 'water'
    const spot = kind ? this.reserveSpot(a, kind) : null
    if (!spot) {
      this.setPlan(a, 'idle', [this.idleWork()])
      return
    }
    const label: Record<SpotKind, [string, AnimState, string?]> = {
      coffee: ['Nghỉ giải lao ở pantry', 'drink', '☕'],
      printer: ['In tài liệu', 'idle', '🖨️'],
      water: ['Lấy nước', 'drink', '💧'],
      chat: ['Trò chuyện', 'talk'],
    }
    const [activity, anim, bubble] = label[spot.kind]
    this.setPlan(a, 'idle', [
      { kind: 'goto', target: spot, heading: spot.heading, activity },
      { kind: 'pose', anim, duration: 4 + this.rand() * 5, activity, bubble },
      { kind: 'call', fn: (ag) => this.releaseSpot(ag) },
    ])
  }

  private idleWork(): Action {
    return { kind: 'pose', anim: 'type', duration: 12 + this.rand() * 20, activity: 'Làm việc tại bàn' }
  }

  private setPlan(a: Agent, kind: Agent['planKind'], plan: Action[]) {
    if (kind === 'job') this.releaseSpot(a)
    a.planKind = kind
    a.plan = plan
  }

  private reserveSpot(a: Agent, kind: SpotKind): ActivitySpot | null {
    const free = ACTIVITY_SPOTS.filter((s) => s.kind === kind && !this.spotOwner.has(s.id))
    if (!free.length) return null
    const s = free[Math.floor(this.rand() * free.length)]
    this.spotOwner.set(s.id, a.id)
    a.reservedSpot = s.id
    return s
  }

  private releaseSpot(a: Agent) {
    if (a.reservedSpot) this.spotOwner.delete(a.reservedSpot)
    a.reservedSpot = null
  }

  // ------------------------------------------------------------ nghiệp vụ

  private assignTask(t: Task, to: DeptId, title?: string, effort?: number) {
    t.dept = to
    if (title) t.title = title
    t.effort = effort ?? t.effort
    t.progress = 0
    t.status = 'queued'
    this.agentById[to].backlog.push(t.id)
  }

  private deliver(a: Agent, t: Task, job: Extract<Job, { kind: 'handoff' }>) {
    a.carrying = false
    const from = a.id
    this.assignTask(t, job.to, job.title, job.effort)
    this.say(this.agentById[job.to], 'Đã nhận, mình xử lý ngay 👍', 2.5)
    this.fx.push({ id: ++this.fxSeq, from, to: job.to, until: this.time + 3 })
    this.log(`${DEPT_BY_ID[from].name} → ${DEPT_BY_ID[job.to].name}: ${t.title}`, 'handoff', from)
    this.emit({ type: 'handoff_delivered', taskId: t.id, from, to: job.to })
  }

  private activeMeeting(): Meeting | undefined {
    for (const m of this.meetings.values()) if (!m.ended && !this.pendingMeetings.includes(m)) return m
    return undefined
  }

  private openMeeting(m: Meeting) {
    m.createdAt = this.time
    for (const p of m.participants) this.agentById[p].jobs.push({ kind: 'meeting', meetingId: m.id })
    const names = m.participants.map((p) => DEPT_BY_ID[p].name).join(', ')
    this.log(`Triệu tập họp "${m.topic}" (${names})`, 'meeting')
  }

  private updateMeetings() {
    for (const m of this.meetings.values()) {
      if (m.ended || this.pendingMeetings.includes(m)) continue
      if (m.startedAt === null) {
        const all = m.arrived.size === m.participants.length
        const timeout = this.time - m.createdAt > 45 && m.arrived.size >= 2
        if (all || timeout) {
          m.startedAt = this.time
          m.endsAt = this.time + m.duration
          m.nextSpeakAt = this.time
          this.log(`Bắt đầu họp: ${m.topic}`, 'meeting')
        }
        continue
      }
      if (this.time >= m.endsAt) {
        m.ended = true
        m.speaker = null
        this.meetings.delete(m.id)
        this.log(`Kết thúc họp: ${m.topic}`, 'meeting')
        this.emit({ type: 'meeting_ended', meetingId: m.id })
        const next = this.pendingMeetings.shift()
        if (next) this.openMeeting(next)
        continue
      }
      if (this.time >= m.nextSpeakAt) {
        const present = [...m.arrived]
        const cands = present.filter((p) => p !== m.speaker)
        m.speaker = cands.length ? cands[Math.floor(this.rand() * cands.length)] : (present[0] ?? null)
        m.nextSpeakAt = this.time + 3.5
        if (m.speaker) {
          this.say(this.agentById[m.speaker], MEETING_LINES[Math.floor(this.rand() * MEETING_LINES.length)], 3.3)
        }
      }
    }
  }

  // ------------------------------------------------------------ tiện ích

  say(a: Agent, text: string, seconds: number) {
    a.bubble = { text, until: this.time + seconds }
  }

  private log(text: string, kind: FeedKind, dept?: DeptId) {
    this.note(text, kind, dept, this.realTime ? Date.now() : undefined)
  }

  /** Ghi nhật ký từ nguồn ngoài (vd lịch sử transcript) mà không tạo hành động; giữ thứ tự theo giờ thật */
  note(text: string, kind: FeedKind, dept?: DeptId, at?: number) {
    const item = { id: ++this.feedSeq, time: this.time, text, kind, dept, at }
    if (at !== undefined && this.feed.length && (this.feed[this.feed.length - 1].at ?? Infinity) > at) {
      const i = this.feed.findIndex((f) => (f.at ?? Infinity) > at)
      this.feed.splice(i, 0, item)
    } else this.feed.push(item)
    if (this.feed.length > 300) this.feed.splice(0, this.feed.length - 300)
  }

  private emit(n: EngineNotice) {
    for (const fn of this.listeners) fn(n)
  }
}

/** Giờ văn phòng: 1 giây mô phỏng = 1 phút, bắt đầu 08:00 */
export function formatClock(t: number): string {
  const total = 8 * 60 + Math.floor(t)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
