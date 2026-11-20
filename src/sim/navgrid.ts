import type { Rect, Vec2 } from './types'

export interface NavGridOptions {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cell: number
  /** bán kính agent – vật cản được nới ra thêm khoảng này */
  radius: number
}

/** Lưới chiếm chỗ + A* (8 hướng, không cắt góc) + làm mượt đường bằng line-of-sight */
export class NavGrid {
  readonly cols: number
  readonly rows: number
  readonly blocked: Uint8Array
  readonly opt: NavGridOptions

  constructor(opt: NavGridOptions, obstacles: Rect[]) {
    this.opt = opt
    this.cols = Math.round((opt.maxX - opt.minX) / opt.cell)
    this.rows = Math.round((opt.maxZ - opt.minZ) / opt.cell)
    this.blocked = new Uint8Array(this.cols * this.rows)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = this.center(c, r)
        for (const o of obstacles) {
          if (
            Math.abs(p.x - o.x) < o.w / 2 + opt.radius &&
            Math.abs(p.z - o.z) < o.d / 2 + opt.radius
          ) {
            this.blocked[r * this.cols + c] = 1
            break
          }
        }
      }
    }
  }

  center(c: number, r: number): Vec2 {
    return { x: this.opt.minX + (c + 0.5) * this.opt.cell, z: this.opt.minZ + (r + 0.5) * this.opt.cell }
  }

  cellOf(p: Vec2): [number, number] {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((p.x - this.opt.minX) / this.opt.cell)))
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((p.z - this.opt.minZ) / this.opt.cell)))
    return [c, r]
  }

  isBlocked(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return true
    return this.blocked[r * this.cols + c] === 1
  }

  isFreeAt(p: Vec2): boolean {
    const [c, r] = this.cellOf(p)
    return !this.isBlocked(c, r)
  }

  /** Ô trống gần nhất (BFS) */
  nearestFree(c0: number, r0: number): [number, number] | null {
    if (!this.isBlocked(c0, r0)) return [c0, r0]
    const seen = new Uint8Array(this.cols * this.rows)
    const q: [number, number][] = [[c0, r0]]
    seen[r0 * this.cols + c0] = 1
    for (let i = 0; i < q.length; i++) {
      const [c, r] = q[i]
      for (const [dc, dr] of DIRS4) {
        const nc = c + dc
        const nr = r + dr
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue
        const k = nr * this.cols + nc
        if (seen[k]) continue
        seen[k] = 1
        if (!this.blocked[k]) return [nc, nr]
        q.push([nc, nr])
      }
    }
    return null
  }

  /** Trả về danh sách điểm (không gồm điểm xuất phát), điểm cuối là đúng `to`. null nếu không có đường. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const s = this.nearestFree(...this.cellOf(from))
    const g = this.nearestFree(...this.cellOf(to))
    if (!s || !g) return null
    const cells = this.astar(s, g)
    if (!cells) return null
    const pts = cells.map(([c, r]) => this.center(c, r))
    pts[0] = { x: from.x, z: from.z }
    pts.push({ x: to.x, z: to.z })
    return this.smooth(pts).slice(1)
  }

  private astar(s: [number, number], g: [number, number]): [number, number][] | null {
    const { cols } = this
    const n = cols * this.rows
    const gScore = new Float32Array(n).fill(Infinity)
    const came = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const start = s[1] * cols + s[0]
    const goal = g[1] * cols + g[0]
    const heap = new MinHeap()
    gScore[start] = 0
    heap.push(start, octile(s[0], s[1], g[0], g[1]))
    while (heap.size) {
      const cur = heap.pop()
      if (cur === goal) break
      if (closed[cur]) continue
      closed[cur] = 1
      const cc = cur % cols
      const cr = (cur / cols) | 0
      for (const [dc, dr, cost] of DIRS8) {
        const nc = cc + dc
        const nr = cr + dr
        if (this.isBlocked(nc, nr)) continue
        // không cắt góc qua vật cản
        if (dc !== 0 && dr !== 0 && (this.isBlocked(cc + dc, cr) || this.isBlocked(cc, cr + dr))) continue
        const k = nr * cols + nc
        const ng = gScore[cur] + cost
        if (ng < gScore[k]) {
          gScore[k] = ng
          came[k] = cur
          heap.push(k, ng + octile(nc, nr, g[0], g[1]))
        }
      }
    }
    if (start !== goal && came[goal] === -1) return null
    const out: [number, number][] = []
    for (let k = goal; k !== -1; k = came[k]) {
      out.push([k % cols, (k / cols) | 0])
      if (k === start) break
    }
    return out.reverse()
  }

  /** Kiểm tra đoạn thẳng a→b chỉ đi qua ô trống (lấy mẫu dày) */
  lineOfSight(a: Vec2, b: Vec2): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z)
    const steps = Math.ceil(dist / (this.opt.cell * 0.25))
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      if (!this.isFreeAt({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false
    }
    return true
  }

  /** String pulling: nối thẳng tới điểm xa nhất còn nhìn thấy */
  private smooth(pts: Vec2[]): Vec2[] {
    if (pts.length <= 2) return pts
    const out = [pts[0]]
    let i = 0
    while (i < pts.length - 1) {
      let j = pts.length - 1
      while (j > i + 1 && !this.lineOfSight(pts[i], pts[j])) j--
      out.push(pts[j])
      i = j
    }
    return out
  }
}

const SQ2 = Math.SQRT2
const DIRS4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
const DIRS8: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQ2],
  [1, -1, SQ2],
  [-1, 1, SQ2],
  [-1, -1, SQ2],
]

function octile(c1: number, r1: number, c2: number, r2: number) {
  const dx = Math.abs(c1 - c2)
  const dy = Math.abs(r1 - r2)
  return dx + dy + (SQ2 - 2) * Math.min(dx, dy)
}

class MinHeap {
  private keys: number[] = []
  private pri: number[] = []
  get size() {
    return this.keys.length
  }
  push(k: number, p: number) {
    this.keys.push(k)
    this.pri.push(p)
    let i = this.keys.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.pri[parent] <= this.pri[i]) break
      this.swap(i, parent)
      i = parent
    }
  }
  pop(): number {
    const top = this.keys[0]
    const lastK = this.keys.pop()!
    const lastP = this.pri.pop()!
    if (this.keys.length) {
      this.keys[0] = lastK
      this.pri[0] = lastP
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.keys.length && this.pri[l] < this.pri[m]) m = l
        if (r < this.keys.length && this.pri[r] < this.pri[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
  private swap(a: number, b: number) {
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
    ;[this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]]
  }
}
