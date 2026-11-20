import { describe, expect, it } from 'vitest'
import { MockSource } from '../sources/mockSource'
import { Engine } from './engine'
import { ACTIVITY_SPOTS, DEPARTMENTS, MEETING_SEATS } from './layout'
import type { Vec2 } from './types'

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

describe('NavGrid', () => {
  const engine = new Engine()
  const targets: Vec2[] = [
    ...DEPARTMENTS.flatMap((d) => [d.seat, d.guest]),
    ...MEETING_SEATS,
    ...ACTIVITY_SPOTS,
  ]

  it('mọi điểm hoạt động đều tới được từ bàn CEO', () => {
    const from = DEPARTMENTS[0].seat
    for (const t of targets) {
      const path = engine.nav.findPath(from, t)
      expect(path, `không tới được (${t.x}, ${t.z})`).not.toBeNull()
      expect(path!.at(-1)).toEqual({ x: t.x, z: t.z })
    }
  })

  it('đường đi không xuyên tường (trừ đoạn cuối vào ghế)', () => {
    const a = DEPARTMENTS.find((d) => d.id === 'ceo')!.guest
    const b = DEPARTMENTS.find((d) => d.id === 'support')!.guest
    const path = engine.nav.findPath(a, b)!
    let prev: Vec2 = a
    for (const p of path) {
      expect(engine.nav.lineOfSight(prev, p)).toBe(true)
      prev = p
    }
  })
})

describe('Engine + MockSource', () => {
  it('chạy 20 phút mô phỏng: có việc hoàn tất, có họp, không ai kẹt', () => {
    const rand = seeded(42)
    const engine = new Engine({ random: rand })
    const src = new MockSource({ random: rand })
    src.attach(engine)

    const lastMoved = new Map(engine.agents.map((a) => [a.id, { ...a.pos, t: 0 }]))
    let meetingsStarted = 0
    let handoffs = 0
    engine.onNotice((n) => {
      if (n.type === 'handoff_delivered') handoffs++
    })

    const dt = 1 / 30
    for (let i = 0; i < 20 * 60 * 30; i++) {
      src.update()
      engine.update(dt)
      for (const a of engine.agents) {
        expect(Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z)).toBe(true)
        let lm = lastMoved.get(a.id)!
        if (Math.hypot(a.pos.x - lm.x, a.pos.z - lm.z) > 0.01) {
          lm = { ...a.pos, t: engine.time }
          lastMoved.set(a.id, lm)
        }
        // đang đi bộ mà đứng yên quá 5s => kẹt
        if (a.anim === 'walk' || a.anim === 'carry') expect(engine.time - lm.t).toBeLessThan(5)
      }
    }
    meetingsStarted = engine.feed.filter((f) => f.text.startsWith('Bắt đầu họp')).length

    expect(engine.completedCount).toBeGreaterThan(3)
    expect(handoffs).toBeGreaterThan(5)
    expect(meetingsStarted + engine.feed.filter((f) => f.text.startsWith('Kết thúc họp')).length).toBeGreaterThan(0)
  })

  it('nguồn ngoài có thể điều khiển tiến độ (task_progress)', () => {
    const engine = new Engine({ random: seeded(1) })
    engine.dispatch({ type: 'task_created', taskId: 'X', dept: 'legal', title: 'Việc thật' })
    for (let i = 0; i < 60; i++) engine.update(0.1)
    expect(engine.tasks.get('X')!.status).toBe('working')
    expect(engine.tasks.get('X')!.progress).toBe(0)
    engine.dispatch({ type: 'task_progress', taskId: 'X', progress: 1 })
    engine.update(0.1)
    expect(engine.tasks.get('X')!.status).toBe('waiting')
  })
})
