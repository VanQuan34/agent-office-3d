import { CONFIG, IS_LIVE, type RosterAgent } from '../config'
import type { DeptId, Rect, Spot, Vec2 } from './types'

/**
 * Bố cục văn phòng (đơn vị: mét). Trục x: trái→phải, trục z: trên(bắc)→dưới(nam).
 *
 *   z=-11 ┌── phòng ── phòng ── … ┐   dãy bắc (phòng sâu 7m)
 *   z=-4  ├───────────────────────┤   vách kính, cửa lệch mỗi phòng
 *         │ Phòng họp │ Sảnh · Máy in · Pantry │  hành lang 8m
 *   z=4   ├───────────────────────┤
 *   z=11  └── phòng ── phòng ── … ┘   dãy nam
 *
 * - Chế độ mô phỏng: 8 phòng ban thiết kế tay (DEFS) trên mặt bằng 36 × 22m.
 * - Chế độ live (CLI đọc agent thật): mỗi agent một phòng, dùng 8 phòng thiết kế tay làm
 *   "mẫu phòng" (theme). Chiều ngang toà nhà tự nới theo số phòng.
 */

export const WALL_T = 0.15
export const WALL_H = 2.8
export const DOOR_W = 1.8
const ROOM_D = 7

export type ThemeId = 'ceo' | 'legal' | 'finance' | 'hr' | 'sales' | 'marketing' | 'engineering' | 'support'
export type DeskStyle = 'standard' | 'executive' | 'dual' | 'counter' | 'creative'

/** Bàn làm việc: (x,z) tâm; w × d kích thước cục bộ; heading = hướng người ngồi nhìn */
export interface DeskSpec {
  x: number
  z: number
  w: number
  d: number
  heading: number
  style: DeskStyle
}

/** Nội thất trong phòng. heading = hướng mặt trước của món đồ (0 = +z, π/2 = +x) */
export type RoomItem =
  | { kind: 'shelves'; x: number; z: number; heading: number; units: number }
  | { kind: 'sideTable'; x: number; z: number; axis: 'x' | 'z' }
  | { kind: 'plant'; x: number; z: number; tall?: boolean }
  | { kind: 'cabinet'; x: number; z: number; heading: number }
  | { kind: 'sofa'; x: number; z: number; heading: number }
  | { kind: 'coffeeTable'; x: number; z: number }
  | { kind: 'armChair'; x: number; z: number; heading: number }
  | { kind: 'meetingTable'; x: number; z: number; w: number; d: number }
  | { kind: 'whiteboard'; x: number; z: number; heading: number; w: number }
  | { kind: 'filing'; x: number; z: number; heading: number; count: number }
  | { kind: 'serverRack'; x: number; z: number; heading: number; count: number }
  | { kind: 'workbench'; x: number; z: number; heading: number }
  | { kind: 'safe'; x: number; z: number; heading: number }
  | { kind: 'beanBag'; x: number; z: number; color: string }
  | { kind: 'rug'; x: number; z: number; w: number; d: number; color: string; round?: boolean }
  | { kind: 'frame'; x: number; z: number; heading: number; variant: 'A' | 'B' }
  | { kind: 'clock'; x: number; z: number; heading: number }

export type FloorKind = 'carpetLight' | 'carpetDark' | 'walnut' | 'oak'

export interface Department {
  id: DeptId
  /** mẫu phòng (quyết định nội thất, kiểu tóc/phụ kiện nhân vật) */
  theme: ThemeId
  name: string
  agentName: string
  role: string
  color: string
  side: 'north' | 'south'
  room: Rect
  desk: DeskSpec
  seat: Spot
  guest: Spot
  door: Vec2
  floor: { kind: FloorKind; tint: number }
  items: RoomItem[]
  /** thông tin agent thật (chế độ live) */
  agent?: RosterAgent
}

/** Phòng trống lấp đầy dãy (không có agent, không có cửa) */
export interface FillerRoom {
  side: 'north' | 'south'
  room: Rect
  items: RoomItem[]
}

interface DeptDef {
  id: ThemeId
  name: string
  agentName: string
  role: string
  color: string
  side: 'north' | 'south'
  /** khoảng x của phòng */
  span: [number, number]
  doorX: number
  desk: DeskSpec
  floor: Department['floor']
  items: RoomItem[]
}

const PI = Math.PI
const E = PI / 2 // nhìn về +x
const W = -PI / 2 // nhìn về -x

/**
 * 8 phòng thiết kế tay (cũng là 8 mẫu phòng cho chế độ live):
 *  - Giám đốc: phòng góc rộng, bàn lớn quay ngang, tủ sau lưng, góc sofa tiếp khách
 *  - Pháp chế: "thư viện" – kệ sách 2 mặt tường, bàn sát tường đông, góc đọc
 *  - Tài chính: dãy tủ hồ sơ, két sắt, bảng KPI, bàn trao đổi nhỏ
 *  - Nhân sự: không gian ấm – sofa + thảm tròn, bàn sát tường
 *  - Kinh doanh: bàn họp khách 4 ghế, tủ trưng bày, bảng pipeline
 *  - Marketing: bàn dài sáng tạo, moodboard, ghế lười, sàn gỗ sáng
 *  - Kỹ thuật: bàn 2 màn hình, tủ server, bàn thợ
 *  - CSKH: quầy tiếp nhận quay ra hành lang, góc chờ
 */
const DEFS: DeptDef[] = [
  {
    id: 'ceo', name: 'Ban Giám đốc', agentName: 'Minh', role: 'Điều phối chung', color: '#c9a227',
    side: 'north', span: [-18, -7.5], doorX: -9.4,
    desk: { x: -15.2, z: -7.6, w: 2.2, d: 1.0, heading: E, style: 'executive' },
    floor: { kind: 'walnut', tint: 0 },
    items: [
      { kind: 'cabinet', x: -17.6, z: -7.6, heading: E },
      { kind: 'shelves', x: -15.6, z: -10.75, heading: 0, units: 2 },
      { kind: 'rug', x: -11.2, z: -9.4, w: 4.4, d: 3.0, color: '#8c7b6b' },
      { kind: 'sofa', x: -11.2, z: -10.35, heading: 0 },
      { kind: 'coffeeTable', x: -11.2, z: -9.0 },
      { kind: 'armChair', x: -12.75, z: -9.0, heading: E },
      { kind: 'armChair', x: -9.65, z: -9.0, heading: W },
      { kind: 'plant', x: -17.4, z: -10.4, tall: true },
      { kind: 'plant', x: -8.1, z: -10.4, tall: true },
      { kind: 'frame', x: -7.58, z: -6.3, heading: W, variant: 'B' },
      { kind: 'clock', x: -7.58, z: -8.2, heading: W },
    ],
  },
  {
    id: 'legal', name: 'Pháp chế', agentName: 'Lan', role: 'Hợp đồng & tuân thủ', color: '#8e6cc7',
    side: 'north', span: [-7.5, 0], doorX: -5.6,
    desk: { x: -1.9, z: -7.4, w: 1.8, d: 0.8, heading: W, style: 'standard' },
    floor: { kind: 'carpetDark', tint: 0.18 },
    items: [
      { kind: 'shelves', x: -3.0, z: -10.75, heading: 0, units: 3 },
      { kind: 'shelves', x: -7.25, z: -8.6, heading: E, units: 2 },
      { kind: 'rug', x: -5.6, z: -8.2, w: 2.8, d: 1.8, color: '#b9a7d6' },
      { kind: 'sideTable', x: -5.6, z: -8.2, axis: 'x' },
      { kind: 'plant', x: -0.5, z: -10.4 },
      { kind: 'plant', x: -7.05, z: -5.3 },
      { kind: 'clock', x: -0.08, z: -9.2, heading: W },
    ],
  },
  {
    id: 'finance', name: 'Tài chính', agentName: 'Phúc', role: 'Kế toán & ngân sách', color: '#2e9d62',
    side: 'north', span: [0, 9], doorX: 2.0,
    desk: { x: 5.2, z: -8.3, w: 1.8, d: 0.8, heading: 0, style: 'standard' },
    floor: { kind: 'carpetLight', tint: 0.2 },
    items: [
      { kind: 'filing', x: 8.6, z: -8.0, heading: W, count: 4 },
      { kind: 'safe', x: 8.5, z: -10.45, heading: W },
      { kind: 'sideTable', x: 1.6, z: -8.0, axis: 'z' },
      { kind: 'whiteboard', x: 0.1, z: -6.0, heading: E, w: 1.8 },
      { kind: 'plant', x: 0.5, z: -10.45 },
      { kind: 'plant', x: 8.5, z: -4.7 },
      { kind: 'frame', x: 8.92, z: -5.8, heading: W, variant: 'A' },
    ],
  },
  {
    id: 'hr', name: 'Nhân sự', agentName: 'Hà', role: 'Tuyển dụng & con người', color: '#e07a5f',
    side: 'north', span: [9, 18], doorX: 12.4,
    desk: { x: 11.6, z: -8.9, w: 1.8, d: 0.8, heading: 0, style: 'standard' },
    floor: { kind: 'carpetLight', tint: 0.26 },
    items: [
      { kind: 'rug', x: 16.3, z: -7.6, w: 3.0, d: 4.4, color: '#e9c6a6', round: true },
      { kind: 'sofa', x: 17.35, z: -7.6, heading: W },
      { kind: 'coffeeTable', x: 15.9, z: -7.6 },
      { kind: 'armChair', x: 15.9, z: -9.3, heading: 0 },
      { kind: 'armChair', x: 15.9, z: -5.9, heading: PI },
      { kind: 'shelves', x: 14.3, z: -10.75, heading: 0, units: 1 },
      { kind: 'plant', x: 9.5, z: -10.4, tall: true },
      { kind: 'plant', x: 17.4, z: -10.4 },
      { kind: 'plant', x: 17.4, z: -4.7 },
      { kind: 'frame', x: 9.08, z: -6.2, heading: E, variant: 'A' },
      { kind: 'clock', x: 9.08, z: -9.0, heading: E },
    ],
  },
  {
    id: 'sales', name: 'Kinh doanh', agentName: 'Nam', role: 'Bán hàng & khách hàng', color: '#d63a4a',
    side: 'south', span: [-18, -9], doorX: -11.6,
    desk: { x: -15.6, z: 7.0, w: 1.8, d: 0.8, heading: E, style: 'standard' },
    floor: { kind: 'carpetDark', tint: 0.12 },
    items: [
      { kind: 'meetingTable', x: -12.0, z: 8.8, w: 2.0, d: 1.0 },
      { kind: 'cabinet', x: -13.5, z: 10.72, heading: PI },
      { kind: 'whiteboard', x: -9.1, z: 7.0, heading: W, w: 2.0 },
      { kind: 'plant', x: -17.4, z: 10.4, tall: true },
      { kind: 'plant', x: -9.6, z: 10.4 },
    ],
  },
  {
    id: 'marketing', name: 'Marketing', agentName: 'Vy', role: 'Thương hiệu & chiến dịch', color: '#f09a3e',
    side: 'south', span: [-9, 1], doorX: -6.5,
    desk: { x: -2.4, z: 7.2, w: 2.6, d: 1.0, heading: PI, style: 'creative' },
    floor: { kind: 'oak', tint: 0 },
    items: [
      { kind: 'whiteboard', x: -8.9, z: 7.2, heading: E, w: 2.4 },
      { kind: 'rug', x: -6.8, z: 9.3, w: 3.2, d: 2.8, color: '#f3c98b', round: true },
      { kind: 'beanBag', x: -7.4, z: 9.7, color: '#f09a3e' },
      { kind: 'beanBag', x: -6.1, z: 10.1, color: '#3a7bff' },
      { kind: 'beanBag', x: -7.7, z: 8.4, color: '#e05a7a' },
      { kind: 'shelves', x: -2.2, z: 10.75, heading: PI, units: 1 },
      { kind: 'plant', x: 0.4, z: 10.4, tall: true },
      { kind: 'plant', x: -4.4, z: 10.45 },
      { kind: 'plant', x: 0.4, z: 4.6 },
    ],
  },
  {
    id: 'engineering', name: 'Kỹ thuật', agentName: 'Khoa', role: 'Phát triển sản phẩm', color: '#3a7bff',
    side: 'south', span: [1, 11], doorX: 3.2,
    desk: { x: 8.2, z: 7.6, w: 2.0, d: 0.85, heading: E, style: 'dual' },
    floor: { kind: 'carpetDark', tint: 0 },
    items: [
      { kind: 'serverRack', x: 3.4, z: 10.5, heading: PI, count: 3 },
      { kind: 'workbench', x: 1.45, z: 7.4, heading: E },
      { kind: 'whiteboard', x: 10.9, z: 9.6, heading: W, w: 1.6 },
      { kind: 'plant', x: 10.4, z: 10.4 },
      { kind: 'plant', x: 10.4, z: 4.6 },
      { kind: 'plant', x: 6.0, z: 10.5, tall: true },
    ],
  },
  {
    id: 'support', name: 'CSKH', agentName: 'Chi', role: 'Hỗ trợ khách hàng', color: '#1fa595',
    side: 'south', span: [11, 18], doorX: 13.2,
    desk: { x: 15.6, z: 6.3, w: 2.2, d: 0.8, heading: PI, style: 'counter' },
    floor: { kind: 'carpetLight', tint: 0.22 },
    items: [
      { kind: 'coffeeTable', x: 12.6, z: 9.0 },
      { kind: 'armChair', x: 12.6, z: 10.3, heading: PI },
      { kind: 'armChair', x: 14.1, z: 9.0, heading: W },
      { kind: 'shelves', x: 16.4, z: 10.75, heading: PI, units: 2 },
      { kind: 'plant', x: 11.5, z: 10.5 },
      { kind: 'plant', x: 17.45, z: 4.6, tall: true },
      { kind: 'clock', x: 11.08, z: 7.2, heading: E },
    ],
  },
]

// ---------------------------------------------------------------- mẫu phòng (toạ độ cục bộ)

/**
 * Hệ cục bộ của một phòng: gốc ở tâm phòng, +z hướng ra hành lang (phía cửa), -z là tường sau.
 * Phòng dãy bắc trùng hướng thế giới; phòng dãy nam xoay 180°.
 */
interface Template {
  theme: ThemeId
  width: number
  doorX: number
  desk: DeskSpec
  floor: Department['floor']
  items: RoomItem[]
}

type Xf = (x: number, z: number, h: number) => [number, number, number]

/** Đổi toàn bộ toạ độ (bàn + nội thất) qua một phép biến đổi */
function mapLayout(desk: DeskSpec, items: RoomItem[], f: Xf): { desk: DeskSpec; items: RoomItem[] } {
  const [dx, dz, dh] = f(desk.x, desk.z, desk.heading)
  return {
    desk: { ...desk, x: dx, z: dz, heading: dh },
    items: items.map((it) => {
      const [x, z, h] = f(it.x, it.z, 'heading' in it ? it.heading : 0)
      return 'heading' in it ? ({ ...it, x, z, heading: h } as RoomItem) : ({ ...it, x, z } as RoomItem)
    }),
  }
}

function toTemplate(def: DeptDef): Template {
  const cx = (def.span[0] + def.span[1]) / 2
  const north = def.side === 'north'
  const f: Xf = north ? (x, z, h) => [x - cx, z + 7.5, h] : (x, z, h) => [-(x - cx), -(z - 7.5), h + PI]
  const { desk, items } = mapLayout(def.desk, def.items, f)
  return {
    theme: def.id,
    width: def.span[1] - def.span[0],
    doorX: north ? def.doorX - cx : -(def.doorX - cx),
    desk,
    floor: def.floor,
    items,
  }
}

export const TEMPLATES = Object.fromEntries(DEFS.map((d) => [d.id, toTemplate(d)])) as Record<ThemeId, Template>

/** Đặt mẫu phòng vào vị trí thật; mirror = lật trái/phải để 2 phòng cùng mẫu không giống hệt */
function placeTemplate(t: Template, cx: number, side: 'north' | 'south', mirror: boolean) {
  const north = side === 'north'
  const f: Xf = (x, z, h) => {
    if (mirror) {
      x = -x
      h = -h
    }
    return north ? [cx + x, -7.5 + z, h] : [cx - x, 7.5 - z, h + PI]
  }
  const { desk, items } = mapLayout(t.desk, t.items, f)
  const doorLocal = mirror ? -t.doorX : t.doorX
  return { desk, items, doorX: north ? cx + doorLocal : cx - doorLocal }
}

// ---------------------------------------------------------------- dựng danh sách phòng ban

function finishDept(base: Omit<Department, 'seat' | 'guest'>): Department {
  const { desk } = base
  const fx = Math.sin(desk.heading)
  const fz = Math.cos(desk.heading)
  const back = desk.d / 2 + 0.6
  const front = desk.d / 2 + 1.0
  return {
    ...base,
    seat: { x: desk.x - fx * back, z: desk.z - fz * back, heading: desk.heading },
    guest: { x: desk.x + fx * front, z: desk.z + fz * front, heading: desk.heading + PI },
  }
}

function classicDepartments(): Department[] {
  return DEFS.map((def) =>
    finishDept({
      id: def.id,
      theme: def.id,
      name: def.name,
      agentName: def.agentName,
      role: def.role,
      color: def.color,
      side: def.side,
      room: { x: (def.span[0] + def.span[1]) / 2, z: def.side === 'north' ? -7.5 : 7.5, w: def.span[1] - def.span[0], d: ROOM_D },
      desk: def.desk,
      door: { x: def.doorX, z: def.side === 'north' ? -4 : 4 },
      floor: def.floor,
      items: def.items,
    }),
  )
}

const NAMED_COLORS: Record<string, string> = {
  red: '#d63a4a', blue: '#3a7bff', green: '#2e9d62', yellow: '#c9a227', purple: '#8e6cc7',
  orange: '#f09a3e', pink: '#e05a9a', cyan: '#1fa5b5', teal: '#1fa595', gray: '#7a8594', grey: '#7a8594',
}
const PALETTE = ['#3a7bff', '#8e6cc7', '#2e9d62', '#e07a5f', '#d63a4a', '#f09a3e', '#1fa595', '#e05a9a', '#5b6ee1', '#9aa83a', '#c0703a', '#3aa0c0']

/** Gợi ý mẫu phòng theo tên + mô tả agent */
const THEME_HINTS: [ThemeId, RegExp][] = [
  ['engineering', /code|dev|build|implement|debug|fix|refactor|engineer|backend|frontend|test|gate|runner|commit|git|\bci\b|deploy|general-purpose/i],
  ['legal', /review|audit|contract|complian|policy|verify|lint|plan|architect|spec/i],
  ['finance', /data|metric|analytic|cost|financ|report|sql|log|reader|stat|budget/i],
  ['marketing', /design|figma|\bui\b|content|writer|doc|copy|creative|image|measure|style|brand/i],
  ['sales', /dispatch|api|integrat|client|deliver|handoff|router|orchestr/i],
  ['support', /support|help|triage|locat|search|find|explore|question|answer/i],
  ['hr', /people|\bhr\b|onboard|mentor|coach|\bux\b|user|guide|teach/i],
]

function pickTheme(a: RosterAgent, used: Map<ThemeId, number>): ThemeId {
  const text = `${a.key} ${a.name} ${a.description ?? ''}`
  let best: ThemeId = 'engineering'
  let bestScore = -Infinity
  const all = Object.keys(TEMPLATES).filter((t) => t !== 'ceo') as ThemeId[]
  for (const t of all) {
    const hint = THEME_HINTS.find(([id]) => id === t)?.[1]
    const m = hint ? (`${a.key} ${a.name}`.match(hint) ? 2 : text.match(hint) ? 1 : 0) : 0
    const score = m - (used.get(t) ?? 0) * 0.75
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

const prettyName = (key: string) =>
  key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ')

/** Sinh văn phòng từ danh sách agent thật: mỗi agent một phòng, hai dãy cân bằng chiều dài */
function liveDepartments(agents: RosterAgent[]): { depts: Department[]; fillers: FillerRoom[]; width: number } {
  const used = new Map<ThemeId, number>()
  const plans = agents.map((a, i) => {
    const theme: ThemeId = a.isMain ? 'ceo' : pickTheme(a, used)
    const n = used.get(theme) ?? 0
    used.set(theme, n + 1)
    const color = (a.color && (NAMED_COLORS[a.color.toLowerCase()] ?? (a.color.startsWith('#') ? a.color : undefined))) ?? (a.isMain ? '#c9a227' : PALETTE[i % PALETTE.length])
    return { a, theme, mirror: n % 2 === 1, color, width: TEMPLATES[theme].width }
  })
  // chia 2 dãy: agent chính luôn ở góc tây bắc, còn lại xếp vào dãy đang ngắn hơn
  const rows: Record<'north' | 'south', typeof plans> = { north: [], south: [] }
  const len = (r: typeof plans) => r.reduce((s, p) => s + p.width, 0)
  for (const p of plans) {
    const side = p.a.isMain ? 'north' : len(rows.north) <= len(rows.south) ? 'north' : 'south'
    rows[side].push(p)
  }
  const width = Math.max(36, len(rows.north), len(rows.south))
  const minX = -width / 2
  const depts: Department[] = []
  const fillers: FillerRoom[] = []
  for (const side of ['north', 'south'] as const) {
    let x = minX
    for (const p of rows[side]) {
      const cx = x + p.width / 2
      const placed = placeTemplate(TEMPLATES[p.theme], cx, side, p.mirror)
      const t = TEMPLATES[p.theme]
      depts.push(
        finishDept({
          id: p.a.key,
          theme: p.theme,
          name: p.a.isMain ? 'Điều phối' : p.a.key,
          agentName: p.a.isMain ? p.a.name || 'Claude' : prettyName(p.a.name || p.a.key),
          role: p.a.description?.replace(/\s+/g, ' ').slice(0, 90) ?? '',
          color: p.color,
          side,
          room: { x: cx, z: side === 'north' ? -7.5 : 7.5, w: p.width, d: ROOM_D },
          desk: placed.desk,
          door: { x: placed.doorX, z: side === 'north' ? -4 : 4 },
          floor: t.floor,
          items: placed.items,
          agent: p.a,
        }),
      )
      x += p.width
    }
    const rest = minX + width - x
    if (rest > 0.01) fillers.push(fillerRoom(side, x, rest))
  }
  return { depts, fillers, width }
}

/** Phòng trống lấp chỗ thừa cuối dãy: vài chậu cây + kệ */
function fillerRoom(side: 'north' | 'south', x0: number, w: number): FillerRoom {
  const s = side === 'north' ? -1 : 1
  const cx = x0 + w / 2
  const items: RoomItem[] = [{ kind: 'plant', x: x0 + 0.6, z: s * 10.4, tall: true }]
  if (w > 2.5) items.push({ kind: 'plant', x: x0 + w - 0.6, z: s * 10.4 })
  if (w > 4) items.push({ kind: 'shelves', x: cx, z: s * 10.75, heading: side === 'north' ? 0 : PI, units: Math.min(3, Math.floor((w - 2) / 1.1)) })
  return { side, room: { x: cx, z: s * 7.5, w, d: ROOM_D }, items }
}

const built = IS_LIVE ? liveDepartments(CONFIG.agents!) : { depts: classicDepartments(), fillers: [] as FillerRoom[], width: 36 }

export const DEPARTMENTS: Department[] = built.depts
export const FILLER_ROOMS: FillerRoom[] = built.fillers
export const DEPT_BY_ID = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d])) as Record<DeptId, Department>
export const BOUNDS = { minX: -built.width / 2, maxX: built.width / 2, minZ: -11, maxZ: 11 }

/** Hình chữ nhật chiếm chỗ theo trục toạ độ, đổi w/d khi món đồ quay ngang */
export function rotRect(x: number, z: number, w: number, d: number, heading: number): Rect {
  const side = Math.abs(Math.sin(heading)) > 0.5
  return side ? { x, z, w: d, d: w } : { x, z, w, d }
}

export const deskRect = (d: DeskSpec) => rotRect(d.x, d.z, d.w, d.d, d.heading)

/** Diện tích chiếm chỗ của món đồ (null = không cản đường: thảm, tranh…) */
export function itemRect(it: RoomItem): Rect | null {
  switch (it.kind) {
    case 'shelves':
      return rotRect(it.x, it.z, it.units * 1.1, 0.4, it.heading)
    case 'sideTable':
      return it.axis === 'x' ? { x: it.x, z: it.z, w: 2.6, d: 1.0 } : { x: it.x, z: it.z, w: 1.0, d: 2.6 }
    case 'plant':
      return { x: it.x, z: it.z, w: 0.5, d: 0.5 }
    case 'cabinet':
      return rotRect(it.x, it.z, 2.44, 0.52, it.heading)
    case 'sofa':
      return rotRect(it.x, it.z, 1.85, 0.85, it.heading)
    case 'coffeeTable':
      return { x: it.x, z: it.z, w: 1.3, d: 1.3 }
    case 'armChair':
      return rotRect(it.x, it.z, 0.85, 1.0, it.heading)
    case 'meetingTable':
      return { x: it.x, z: it.z, w: it.w + 0.2, d: it.d + 1.4 }
    case 'whiteboard':
      return rotRect(it.x, it.z, it.w, 0.1, it.heading)
    case 'filing':
      return rotRect(it.x, it.z, it.count * 0.5, 0.6, it.heading)
    case 'serverRack':
      return rotRect(it.x, it.z, it.count * 0.62, 0.9, it.heading)
    case 'workbench':
      return rotRect(it.x, it.z, 2.0, 0.8, it.heading)
    case 'safe':
      return { x: it.x, z: it.z, w: 0.7, d: 0.7 }
    case 'beanBag':
      return { x: it.x, z: it.z, w: 0.8, d: 0.8 }
    default:
      return null
  }
}

// ---------------------------------------------------------------- tường

export type WallKind = 'outer' | 'solid' | 'glass'

export interface Wall {
  /** đoạn thẳng song song trục */
  x1: number
  z1: number
  x2: number
  z2: number
  kind: WallKind
  /** pháp tuyến hướng ra ngoài (chỉ tường bao) – dùng cho hiệu ứng "nhà búp bê" */
  normal?: Vec2
}

/** Tách đoạn [a,b] thành các đoạn chừa khoảng cửa tại các tâm cho trước */
function splitWithDoors(a: number, b: number, doors: number[], w = DOOR_W): [number, number][] {
  const out: [number, number][] = []
  let cur = a
  for (const c of [...doors].sort((p, q) => p - q)) {
    if (c - w / 2 > cur) out.push([cur, c - w / 2])
    cur = c + w / 2
  }
  if (cur < b) out.push([cur, b])
  return out
}

function hWalls(z: number, x1: number, x2: number, kind: WallKind, doors: number[] = []): Wall[] {
  return splitWithDoors(x1, x2, doors).map(([a, b]) => ({ x1: a, z1: z, x2: b, z2: z, kind }))
}
function vWalls(x: number, z1: number, z2: number, kind: WallKind, doors: number[] = []): Wall[] {
  return splitWithDoors(z1, z2, doors).map(([a, b]) => ({ x1: x, z1: a, x2: x, z2: b, kind }))
}

const { minX, maxX, minZ, maxZ } = BOUNDS

const doorsOf = (side: 'north' | 'south') => DEPARTMENTS.filter((d) => d.side === side).map((d) => d.door.x)
const dividersOf = (side: 'north' | 'south') =>
  [...DEPARTMENTS, ...FILLER_ROOMS]
    .filter((d) => d.side === side)
    .map((d) => d.room.x + d.room.w / 2)
    .filter((x) => x < maxX - 0.01)

/** Phòng họp chung luôn nằm ở đầu tây hành lang */
const MR_X0 = minX
const MR_X1 = minX + 8

export const WALLS: Wall[] = [
  // tường bao
  { x1: minX, z1: minZ, x2: maxX, z2: minZ, kind: 'outer', normal: { x: 0, z: -1 } },
  { x1: minX, z1: maxZ, x2: maxX, z2: maxZ, kind: 'outer', normal: { x: 0, z: 1 } },
  { x1: minX, z1: minZ, x2: minX, z2: maxZ, kind: 'outer', normal: { x: -1, z: 0 } },
  { x1: maxX, z1: minZ, x2: maxX, z2: maxZ, kind: 'outer', normal: { x: 1, z: 0 } },
  // vách kính mặt tiền các phòng ban (cửa đặt lệch khác nhau mỗi phòng)
  ...hWalls(-4, minX, maxX, 'glass', doorsOf('north')),
  ...hWalls(4, minX, maxX, 'glass', doorsOf('south')),
  // tường ngăn giữa các phòng
  ...dividersOf('north').flatMap((x) => vWalls(x, minZ, -4, 'solid')),
  ...dividersOf('south').flatMap((x) => vWalls(x, 4, maxZ, 'solid')),
  // phòng họp
  ...hWalls(-2, MR_X0, MR_X1, 'glass'),
  ...hWalls(2, MR_X0, MR_X1, 'glass'),
  ...vWalls(MR_X1, -2, 2, 'glass', [0]),
]

export function wallRect(w: Wall): Rect {
  return {
    x: (w.x1 + w.x2) / 2,
    z: (w.z1 + w.z2) / 2,
    w: Math.abs(w.x2 - w.x1) + WALL_T,
    d: Math.abs(w.z2 - w.z1) + WALL_T,
  }
}

// ---------------------------------------------------------------- khu chung (bám theo 2 đầu toà nhà)

export const MEETING_ROOM: Rect = { x: minX + 4, z: 0, w: 8, d: 4 }
export const MEETING_TABLE: Rect = { x: minX + 3.9, z: 0, w: 4.6, d: 1.4 }
export const MEETING_SEATS: Spot[] = [2.25, 3.35, 4.45, 5.55].flatMap((dx) => [
  { x: minX + dx, z: -1.3, heading: 0 },
  { x: minX + dx, z: 1.3, heading: Math.PI },
])
export const WHITEBOARD = { x: minX + 0.15, z: 0, w: 2.4, heading: Math.PI / 2 }

export const PANTRY_COUNTER: Rect = { x: maxX - 0.45, z: 0, w: 0.7, d: 5 }
/** bàn bar + 2 ghế bar hai bên (theo trục z) */
export const PANTRY_TABLE: Rect = { x: maxX - 4.5, z: 0, w: 0.9, d: 2.0 }
export const PRINTER: Rect = { x: minX + 20, z: -1.0, w: 0.9, d: 0.7 }
export const WATER_COOLER: Rect = { x: minX + 24.5, z: -1.0, w: 0.4, d: 0.4 }
export const SOFA: Rect = { x: minX + 13, z: 1.7, w: 1.85, d: 0.85 }
export const COFFEE_TABLE: Rect = { x: minX + 13, z: 0.35, w: 1.3, d: 1.3 }
/** 2 ghế bành hai bên bàn trà, quay vào nhau */
export const LOUNGE_CHAIRS: (Rect & { heading: number })[] = [
  { x: minX + 11.45, z: 0.35, w: 1.0, d: 0.85, heading: Math.PI / 2 },
  { x: minX + 14.55, z: 0.35, w: 1.0, d: 0.85, heading: -Math.PI / 2 },
]

/** Cây hành lang: đặt sát vách kính tại các vị trí không chắn cửa */
function corridorPlants(): Vec2[] {
  if (!IS_LIVE) {
    return [
      { x: -8.0, z: -3.4 },
      { x: -9.5, z: 3.4 },
      { x: 10, z: -3.4 },
      { x: 10, z: 3.4 },
      { x: 17.4, z: -3.4 },
      { x: 17.4, z: 3.4 },
    ]
  }
  const out: Vec2[] = []
  for (const side of ['north', 'south'] as const) {
    const z = side === 'north' ? -3.4 : 3.4
    const doors = doorsOf(side)
    const cands = [...dividersOf(side), maxX - 0.6]
    for (const x of cands) if (doors.every((d) => Math.abs(d - x) > 1.9) && Math.abs(x - PANTRY_TABLE.x) > 1.5) out.push({ x, z })
  }
  return out
}
export const CORRIDOR_PLANTS: Vec2[] = corridorPlants()

export type SpotKind = 'coffee' | 'printer' | 'water' | 'chat'

export interface ActivitySpot extends Spot {
  id: string
  kind: SpotKind
}

export const ACTIVITY_SPOTS: ActivitySpot[] = [
  { id: 'coffee-1', kind: 'coffee', x: maxX - 1.4, z: -0.8, heading: Math.PI / 2 },
  { id: 'coffee-2', kind: 'coffee', x: maxX - 1.4, z: 0.8, heading: Math.PI / 2 },
  { id: 'chat-1', kind: 'chat', x: PANTRY_TABLE.x - 1, z: 0, heading: Math.PI / 2 },
  { id: 'chat-2', kind: 'chat', x: PANTRY_TABLE.x + 1, z: 0, heading: -Math.PI / 2 },
  { id: 'printer-1', kind: 'printer', x: PRINTER.x, z: -0.1, heading: Math.PI },
  { id: 'water-1', kind: 'water', x: WATER_COOLER.x, z: -0.3, heading: Math.PI },
]

/** Tất cả vật cản cho bản đồ tìm đường */
export function obstacleRects(): Rect[] {
  return [
    ...WALLS.map(wallRect),
    ...DEPARTMENTS.map((d) => deskRect(d.desk)),
    ...[...DEPARTMENTS, ...FILLER_ROOMS].flatMap((d) => d.items.map(itemRect).filter((r): r is Rect => r !== null)),
    MEETING_TABLE,
    rotRect(WHITEBOARD.x, WHITEBOARD.z, WHITEBOARD.w, 0.1, WHITEBOARD.heading),
    PANTRY_COUNTER,
    PANTRY_TABLE,
    PRINTER,
    WATER_COOLER,
    SOFA,
    COFFEE_TABLE,
    ...LOUNGE_CHAIRS,
    ...CORRIDOR_PLANTS.map((p) => ({ x: p.x, z: p.z, w: 0.5, d: 0.5 })),
  ]
}
