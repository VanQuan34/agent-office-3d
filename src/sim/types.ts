/**
 * Định danh phòng ban / agent. Chế độ mô phỏng: 'ceo', 'legal'…;
 * chế độ live: 'main' (agent chính) hoặc subagent_type của Claude Code (vd 'test-runner').
 */
export type DeptId = string

export interface Vec2 {
  x: number
  z: number
}

/** Điểm đứng/ngồi có hướng nhìn. heading = atan2(dx, dz): 0 = nhìn +z, PI = nhìn -z */
export interface Spot extends Vec2 {
  heading: number
}

/** Hình chữ nhật theo tâm: w theo trục x, d theo trục z */
export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

export type AnimState = 'idle' | 'walk' | 'carry' | 'sit' | 'type' | 'talk' | 'sitTalk' | 'drink'

/** Hợp đồng event vào engine – Mock và backend thật đều phát đúng kiểu này */
export type SimEvent =
  | { type: 'task_created'; taskId: string; dept: DeptId; title: string; effort?: number; workflow?: string }
  | { type: 'task_progress'; taskId: string; progress: number }
  | { type: 'handoff'; taskId: string; from: DeptId; to: DeptId; title?: string; effort?: number; note?: string }
  | { type: 'meeting'; meetingId: string; participants: DeptId[]; topic: string; duration?: number }
  | { type: 'message'; from: DeptId; text: string; /** ghi vào nhật ký (mặc định true) */ feed?: boolean; seconds?: number }
  | { type: 'task_done'; taskId: string }

/** Thông báo engine phát ra khi đã "diễn" xong một việc (nguồn mock dùng để đi tiếp workflow) */
export type EngineNotice =
  | { type: 'work_finished'; taskId: string; dept: DeptId }
  | { type: 'handoff_delivered'; taskId: string; from: DeptId; to: DeptId }
  | { type: 'meeting_ended'; meetingId: string }

export type FeedKind = 'task' | 'handoff' | 'meeting' | 'done' | 'info'

export interface FeedItem {
  id: number
  /** giây mô phỏng */
  time: number
  /** thời điểm thật (epoch ms) – chế độ live */
  at?: number
  text: string
  dept?: DeptId
  kind: FeedKind
}
