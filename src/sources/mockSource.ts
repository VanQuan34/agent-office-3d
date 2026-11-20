import type { Engine } from '../sim/engine'
import type { DeptId, EngineNotice } from '../sim/types'
import type { EventSource } from './types'

type Step =
  | { dept: DeptId; title: string; effort: number }
  | { meeting: DeptId[]; topic: string; duration: number }

interface Workflow {
  name: string
  steps: Step[]
}

/** Kịch bản nghiệp vụ mẫu – bước đầu tiên luôn là một việc của phòng ban */
export const WORKFLOWS: Workflow[] = [
  {
    name: 'Hợp đồng khách hàng mới',
    steps: [
      { dept: 'sales', title: 'Chốt deal với khách hàng', effort: 12 },
      { dept: 'legal', title: 'Rà soát hợp đồng', effort: 14 },
      { dept: 'finance', title: 'Xuất hóa đơn', effort: 8 },
      { dept: 'ceo', title: 'Ký duyệt hợp đồng', effort: 5 },
    ],
  },
  {
    name: 'Xử lý ticket khách hàng',
    steps: [
      { dept: 'support', title: 'Tiếp nhận yêu cầu KH', effort: 6 },
      { dept: 'engineering', title: 'Sửa lỗi hệ thống', effort: 16 },
      { dept: 'support', title: 'Phản hồi khách hàng', effort: 6 },
    ],
  },
  {
    name: 'Chiến dịch marketing',
    steps: [
      { dept: 'marketing', title: 'Lên kế hoạch chiến dịch', effort: 12 },
      { meeting: ['marketing', 'sales', 'ceo'], topic: 'Duyệt chiến dịch', duration: 18 },
      { dept: 'finance', title: 'Duyệt ngân sách chiến dịch', effort: 8 },
      { dept: 'marketing', title: 'Triển khai chiến dịch', effort: 12 },
    ],
  },
  {
    name: 'Tuyển dụng kỹ sư',
    steps: [
      { dept: 'hr', title: 'Sàng lọc hồ sơ ứng viên', effort: 9 },
      { dept: 'engineering', title: 'Phỏng vấn kỹ thuật', effort: 12 },
      { dept: 'hr', title: 'Gửi offer', effort: 5 },
    ],
  },
  {
    name: 'Báo cáo tài chính tháng',
    steps: [
      { dept: 'finance', title: 'Tổng hợp số liệu', effort: 14 },
      { dept: 'ceo', title: 'Xem báo cáo tháng', effort: 7 },
    ],
  },
  {
    name: 'Ra mắt tính năng mới',
    steps: [
      { dept: 'engineering', title: 'Hoàn thiện tính năng', effort: 15 },
      { meeting: ['engineering', 'marketing', 'support', 'sales'], topic: 'Kế hoạch ra mắt', duration: 20 },
      { dept: 'marketing', title: 'Viết thông cáo ra mắt', effort: 9 },
      { dept: 'support', title: 'Cập nhật tài liệu hỗ trợ', effort: 7 },
    ],
  },
]

interface Instance {
  id: string
  wf: Workflow
  step: number
  holder: DeptId
}

export interface MockOptions {
  random?: () => number
  /** khoảng thời gian (giây mô phỏng) giữa 2 workflow mới */
  spawnEvery?: [number, number]
  maxConcurrent?: number
  /** thời điểm họp giao ban toàn công ty (null = không họp) */
  standupAt?: number | null
}

export class MockSource implements EventSource {
  private engine!: Engine
  private off?: () => void
  private seq = 0
  private nextSpawn = 2
  private standupDone = false
  private readonly byTask = new Map<string, Instance>()
  private readonly byMeeting = new Map<string, Instance>()
  private readonly rand: () => number
  private readonly spawnEvery: [number, number]
  private readonly maxConcurrent: number
  private readonly standupAt: number | null

  constructor(opts: MockOptions = {}) {
    this.rand = opts.random ?? Math.random
    this.spawnEvery = opts.spawnEvery ?? [14, 26]
    this.maxConcurrent = opts.maxConcurrent ?? 5
    this.standupAt = opts.standupAt === undefined ? 75 : opts.standupAt
  }

  attach(engine: Engine) {
    this.engine = engine
    this.off = engine.onNotice((n) => this.onNotice(n))
  }

  detach() {
    this.off?.()
  }

  update() {
    const t = this.engine.time
    if (t >= this.nextSpawn && this.byTask.size < this.maxConcurrent) {
      this.spawn(WORKFLOWS[Math.floor(this.rand() * WORKFLOWS.length)])
      const [a, b] = this.spawnEvery
      this.nextSpawn = t + a + this.rand() * (b - a)
    }
    if (this.standupAt !== null && !this.standupDone && t >= this.standupAt) {
      this.standupDone = true
      this.engine.dispatch({
        type: 'meeting',
        meetingId: `standup-${++this.seq}`,
        participants: ['ceo', 'legal', 'finance', 'hr', 'sales', 'marketing', 'engineering', 'support'],
        topic: 'Giao ban đầu ngày',
        duration: 22,
      })
    }
  }

  spawn(wf: Workflow) {
    const first = wf.steps[0]
    if (!('dept' in first)) throw new Error(`Workflow "${wf.name}" phải bắt đầu bằng một việc`)
    const inst: Instance = { id: `T${++this.seq}`, wf, step: 0, holder: first.dept }
    this.byTask.set(inst.id, inst)
    this.engine.dispatch({
      type: 'task_created',
      taskId: inst.id,
      dept: first.dept,
      title: first.title,
      effort: first.effort,
      workflow: wf.name,
    })
  }

  private onNotice(n: EngineNotice) {
    if (n.type === 'work_finished') {
      const inst = this.byTask.get(n.taskId)
      if (inst) this.advance(inst)
    } else if (n.type === 'meeting_ended') {
      const inst = this.byMeeting.get(n.meetingId)
      if (inst) {
        this.byMeeting.delete(n.meetingId)
        this.advance(inst)
      }
    }
  }

  private advance(inst: Instance) {
    inst.step++
    const step = inst.wf.steps[inst.step]
    if (!step) {
      this.byTask.delete(inst.id)
      this.engine.dispatch({ type: 'task_done', taskId: inst.id })
      return
    }
    if ('meeting' in step) {
      const meetingId = `M${++this.seq}`
      this.byMeeting.set(meetingId, inst)
      this.engine.dispatch({
        type: 'meeting',
        meetingId,
        participants: step.meeting,
        topic: step.topic,
        duration: step.duration,
      })
      return
    }
    this.engine.dispatch({
      type: 'handoff',
      taskId: inst.id,
      from: inst.holder,
      to: step.dept,
      title: step.title,
      effort: step.effort,
    })
    inst.holder = step.dept
  }
}
