import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RosterAgent } from '../config'

/** Nạp lại layout/engine với cấu hình live giả (layout đọc cấu hình lúc import) */
async function loadLive(agents: RosterAgent[]) {
  vi.resetModules()
  ;(globalThis as { window?: unknown }).window = { __AGENT_OFFICE__: { mode: 'live', agents } }
  const layout = await import('./layout')
  const { Engine } = await import('./engine')
  const { ActivityMapper } = await import('../sources/liveSource')
  return { layout, Engine, ActivityMapper }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const MAIN: RosterAgent = { key: 'main', name: 'Claude', isMain: true }
const SAMPLE = [
  'code-reviewer', 'task-dispatcher', 'api-auditor', 'commit-helper', 'doc-reviewer',
  'ui-designer', 'test-runner', 'file-finder', 'log-analyzer', 'build-dispatcher', 'general-purpose', 'Explore', 'Plan',
].map((key) => ({ key, name: key }))

describe('Văn phòng sinh theo agent thật', () => {
  for (const [label, agents] of [
    ['chỉ agent chính', [MAIN]],
    ['6 agent', [MAIN, ...SAMPLE.slice(0, 5)]],
    ['14 agent (project thật cỡ lớn)', [MAIN, ...SAMPLE]],
  ] as const) {
    it(`${label}: mỗi agent một phòng, không chồng lấn, mọi chỗ đều tới được`, async () => {
      const { layout, Engine } = await loadLive([...agents])
      const { DEPARTMENTS, FILLER_ROOMS, BOUNDS, ACTIVITY_SPOTS, MEETING_SEATS } = layout
      expect(DEPARTMENTS.map((d) => d.id).sort()).toEqual(agents.map((a) => a.key).sort())
      expect(DEPARTMENTS.find((d) => d.id === 'main')!.theme).toBe('ceo')

      // các phòng cùng dãy không chồng lên nhau và nằm trong toà nhà
      for (const side of ['north', 'south'] as const) {
        const rooms = [...DEPARTMENTS, ...FILLER_ROOMS].filter((d) => d.side === side).map((d) => d.room).sort((a, b) => a.x - b.x)
        let x = BOUNDS.minX
        for (const r of rooms) {
          expect(r.x - r.w / 2).toBeCloseTo(x, 5)
          x = r.x + r.w / 2
        }
        expect(x).toBeCloseTo(BOUNDS.maxX, 5)
      }

      const engine = new Engine()
      const from = DEPARTMENTS.find((d) => d.id === 'main')!.seat
      for (const t of [...DEPARTMENTS.flatMap((d) => [d.seat, d.guest]), ...ACTIVITY_SPOTS, ...MEETING_SEATS]) {
        expect(engine.nav.findPath(from, t), `không tới được (${t.x.toFixed(2)}, ${t.z.toFixed(2)})`).not.toBeNull()
      }
    })
  }

  it('agent cùng mẫu phòng được lật gương để không giống hệt nhau', async () => {
    const { layout } = await loadLive([MAIN, { key: 'code-a', name: 'code-a' }, { key: 'code-b', name: 'code-b' }])
    const [, a, b] = layout.DEPARTMENTS
    expect(a.theme).toBe(b.theme)
    const rel = (d: typeof a) => (d.desk.x - d.room.x) * (d.side === 'north' ? 1 : -1)
    expect(Math.sign(rel(a))).not.toBe(Math.sign(rel(b)))
  })
})

describe('ActivityMapper: hoạt động Claude Code → hành động trong văn phòng', () => {
  it('prompt → giao 3 subagent song song → nhận kết quả → trả lời xong', async () => {
    const { Engine, ActivityMapper } = await loadLive([MAIN, ...SAMPLE.slice(0, 5)])
    const engine = new Engine({ random: () => 0.1 })
    const m = new ActivityMapper()
    m.attach(engine)
    const delivered: string[] = []
    engine.onNotice((n) => n.type === 'handoff_delivered' && delivered.push(`${n.from}->${n.to}`))
    const run = (sec: number) => {
      for (let i = 0; i < sec * 20; i++) engine.update(0.05)
    }

    m.handle({ type: 'prompt', session: 's', text: 'Kiểm tra hợp đồng API và chạy gate' })
    run(2)
    m.handle({ type: 'tool', agent: 'main', tool: 'Read', summary: 'README.md' })
    for (const [i, to] of ['api-auditor', 'commit-helper', 'code-reviewer'].entries()) {
      m.handle({ type: 'delegate', id: `t${i}`, from: 'main', to, description: `việc ${i}` })
    }
    run(120) // agent chính lần lượt đi giao 3 phòng
    expect(delivered).toEqual(expect.arrayContaining(['main->api-auditor', 'main->commit-helper', 'main->code-reviewer']))
    m.handle({ type: 'tool', agent: 'commit-helper', tool: 'Bash', summary: 'npm test' })
    expect(engine.agentById['commit-helper'].bubble?.text).toContain('npm test')

    for (const i of [0, 1, 2]) m.handle({ type: 'delegate_done', id: `t${i}` })
    run(120) // 3 subagent mang kết quả về
    expect(delivered).toEqual(expect.arrayContaining(['api-auditor->main', 'commit-helper->main', 'code-reviewer->main']))

    m.handle({ type: 'turn_end', session: 's' })
    run(15)
    expect(engine.tasks.size).toBe(0) // mọi việc đã hoàn tất
    expect(engine.completedCount).toBe(4)
  })

  it('subagent xong trước khi hồ sơ tới nơi vẫn kết thúc đúng', async () => {
    const { Engine, ActivityMapper } = await loadLive([MAIN, ...SAMPLE.slice(0, 3)])
    const engine = new Engine({ random: () => 0.1 })
    const m = new ActivityMapper()
    m.attach(engine)
    m.handle({ type: 'prompt', session: 's', text: 'x' })
    m.handle({ type: 'delegate', id: 'q', from: 'main', to: 'file-finder', description: 'tìm file' })
    m.handle({ type: 'delegate_done', id: 'q' })
    m.handle({ type: 'turn_end', session: 's' })
    for (let i = 0; i < 60 * 20; i++) engine.update(0.05)
    expect(engine.tasks.size).toBe(0)
  })

  it('lịch sử chỉ ghi nhật ký (giờ thật), không tạo việc trong văn phòng', async () => {
    const { Engine, ActivityMapper } = await loadLive([MAIN, ...SAMPLE.slice(0, 3)])
    const engine = new Engine({ realTime: true })
    const m = new ActivityMapper()
    m.attach(engine)
    const at = Date.parse('2026-11-20T09:00:00Z')
    m.handle({
      type: 'history',
      session: 's',
      items: [
        { at, a: { type: 'prompt', session: 's', text: 'Sửa lỗi' } },
        { at: at + 1000, a: { type: 'delegate', id: 'h1', from: 'main', to: 'code-reviewer', description: 'Tìm file' } },
        { at: at + 2000, a: { type: 'tool', agent: 'code-reviewer', tool: 'Grep', summary: 'Grep "login"' } },
        { at: at + 3000, a: { type: 'delegate_done', id: 'h1' } },
      ],
    })
    expect(engine.tasks.size).toBe(0)
    expect(engine.feed.map((f) => f.dept)).toEqual(['main', 'main', 'code-reviewer', 'code-reviewer'])
    expect(engine.feed[2].text).toContain('Grep "login"')
    expect(engine.feed.every((f) => typeof f.at === 'number')).toBe(true)
  })

  it('subagent gọi agy → mang hồ sơ sang Antigravity → Antigravity xong → mang kết quả về đúng người giao', async () => {
    const AGY = { key: 'antigravity', name: 'Antigravity', external: true }
    const { Engine, ActivityMapper } = await loadLive([MAIN, ...SAMPLE.slice(0, 2), AGY])
    const engine = new Engine({ random: () => 0.1 })
    const m = new ActivityMapper()
    m.attach(engine)
    const delivered: string[] = []
    engine.onNotice((n) => n.type === 'handoff_delivered' && delivered.push(`${n.from}->${n.to}`))
    const run = (sec: number) => {
      for (let i = 0; i < sec * 20; i++) engine.update(0.05)
    }
    const disp = SAMPLE[1].key
    m.handle({ type: 'prompt', session: 's', text: 'Giao plan cho agy' })
    m.handle({ type: 'delegate', id: 'd1', from: 'main', to: disp, description: 'Dispatch plan' })
    run(60)
    m.handle({ type: 'tool', agent: disp, tool: 'Bash', summary: 'Giao plan cho agy', launches: 'antigravity' })
    m.handle({ type: 'prompt', agent: 'antigravity', session: 'conv1', text: 'Thực hiện PLAN.md' })
    run(60)
    expect(delivered).toContain(`${disp}->antigravity`)
    m.handle({ type: 'tool', agent: 'antigravity', tool: 'Edit', summary: 'Edit Login.tsx' })
    expect(engine.agentById.antigravity.bubble?.text).toContain('Login.tsx')
    m.handle({ type: 'turn_end', agent: 'antigravity', session: 'conv1' })
    run(60)
    expect(delivered).toContain(`antigravity->${disp}`) // trả về người giao, không phải agent chính
    m.handle({ type: 'delegate_done', id: 'd1' })
    m.handle({ type: 'turn_end', session: 's' })
    run(90)
    expect(engine.tasks.size).toBe(0)
  })

  it('chat trực tiếp với Antigravity → Antigravity tự nhận và hoàn tất yêu cầu', async () => {
    const { Engine, ActivityMapper } = await loadLive([MAIN, { key: 'antigravity', name: 'Antigravity', external: true }])
    const engine = new Engine({ random: () => 0.1 })
    const m = new ActivityMapper()
    m.attach(engine)
    m.handle({ type: 'prompt', agent: 'antigravity', session: 'c', text: 'Viết README' })
    for (let i = 0; i < 40; i++) engine.update(0.05)
    expect([...engine.tasks.values()].map((t) => t.dept)).toEqual(['antigravity'])
    m.handle({ type: 'tool', agent: 'antigravity', tool: 'Write', summary: 'Write README.md' })
    m.handle({ type: 'turn_end', agent: 'antigravity', session: 'c' })
    for (let i = 0; i < 40 * 20; i++) engine.update(0.05)
    expect(engine.tasks.size).toBe(0)
    expect(engine.completedCount).toBe(1)
  })

  it('agent không có phòng → agent chính nhận thay, không lỗi', async () => {
    const { Engine, ActivityMapper } = await loadLive([MAIN])
    const engine = new Engine()
    const m = new ActivityMapper()
    m.attach(engine)
    m.handle({ type: 'delegate', id: 'z', from: 'main', to: 'unknown-agent', description: 'abc' })
    m.handle({ type: 'tool', agent: 'unknown-agent', tool: 'Bash', summary: 'ls' })
    expect(engine.agentById.main.bubble?.text).toContain('ls')
  })
})
