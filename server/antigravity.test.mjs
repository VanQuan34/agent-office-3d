import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AgyWatcher, agyConversationsFor, agyPromptText, agyTimeline, agyTranscript, translateAgyStep, wantsAntigravity } from './antigravity.mjs'
import { Translator } from './transcripts.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const agyDir = path.join(tmp, 'antigravity-cli')
const project = path.join(tmp, 'Proj')
const other = path.join(tmp, 'Other')
fs.mkdirSync(project, { recursive: true })
const line = (o) => JSON.stringify(o) + '\n'
const at = (s) => `2026-11-20T10:00:${String(s).padStart(2, '0')}Z`

function conv(id, workspace, steps) {
  fs.mkdirSync(path.dirname(agyTranscript(agyDir, id)), { recursive: true })
  fs.writeFileSync(agyTranscript(agyDir, id), steps.map(line).join(''))
  fs.appendFileSync(path.join(agyDir, 'history.jsonl'), line({ display: 'x', timestamp: Date.parse(at(steps.length)), workspace, type: 'chat', conversationId: id }))
}

const user = (i, text) => ({ step_index: i, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: at(i), content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>giờ…</ADDITIONAL_METADATA>` })
const plan = (i, calls, status = 'DONE') => ({ step_index: i, source: 'MODEL', type: 'PLANNER_RESPONSE', status, created_at: at(i), content: 'ok', ...(calls ? { tool_calls: calls } : {}) })
const result = (i) => ({ step_index: i, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: at(i), content: '…' })

fs.mkdirSync(agyDir, { recursive: true })
conv('c1', project.toUpperCase(), [
  user(0, 'Sửa màn hình đăng nhập'),
  plan(1, [{ name: 'read_file', args: { Path: 'D:\\p\\src\\Login.tsx' } }]),
  result(2),
  plan(3, [{ name: 'run_command', args: { CommandLine: 'npm test', toolSummary: 'Chạy test' } }, { name: 'edit_file', args: { Path: '/p/a.ts' } }]),
  result(4),
  plan(5, null),
])
conv('c2', other, [user(0, 'project khác')])

describe('Antigravity CLI', () => {
  it('chỉ lấy hội thoại của đúng project (không phân biệt hoa thường)', () => {
    expect([...agyConversationsFor(project, agyDir).keys()]).toEqual(['c1'])
    expect(wantsAntigravity(project, [], agyDir)).toBe(true)
    expect(wantsAntigravity(path.join(tmp, 'none'), [{ key: 'x', description: 'giao plan cho agy' }], agyDir)).toBe(true)
    expect(wantsAntigravity(path.join(tmp, 'none'), [{ key: 'x' }], agyDir)).toBe(false)
  })

  it('dịch bước transcript → prompt / tool / trả lời xong', () => {
    expect(agyPromptText(user(0, 'Xin chào').content)).toBe('Xin chào')
    const tl = agyTimeline(project, { agyDir }).map((x) => x.a)
    expect(tl).toEqual([
      { type: 'prompt', agent: 'antigravity', session: 'c1', text: 'Sửa màn hình đăng nhập' },
      { type: 'tool', agent: 'antigravity', tool: 'Read', summary: 'Read Login.tsx' },
      { type: 'tool', agent: 'antigravity', tool: 'Bash', summary: 'Chạy test' },
      { type: 'tool', agent: 'antigravity', tool: 'Edit', summary: 'Edit a.ts' },
      { type: 'turn_end', agent: 'antigravity', session: 'c1' },
    ])
  })

  it('không phát trùng khi cùng bước được ghi lại (RUNNING → DONE)', () => {
    const seen = new Set()
    const call = [{ name: 'read_file', args: { Path: 'x.ts' } }]
    expect(translateAgyStep(plan(7, call, 'RUNNING'), 'c', seen)).toHaveLength(1)
    expect(translateAgyStep(plan(7, call, 'DONE'), 'c', seen)).toHaveLength(1)
    expect(translateAgyStep(plan(7, call, 'DONE'), 'c', seen)).toHaveLength(0)
  })

  it('watcher live: hội thoại có sẵn đọc từ cuối, hội thoại mới đọc từ đầu', async () => {
    const got = []
    const w = new AgyWatcher(project, { agyDir, pollMs: 20 })
    w.on('activity', (a) => got.push(a))
    w.start()
    await new Promise((r) => setTimeout(r, 60))
    expect(got).toEqual([])
    fs.appendFileSync(agyTranscript(agyDir, 'c1'), line(user(6, 'thêm nút quên mật khẩu')))
    conv('c3', project, [user(0, 'hội thoại mới'), plan(1, [{ name: 'search_web', args: { query: 'react native' } }])])
    await new Promise((r) => setTimeout(r, 120))
    w.stop()
    expect(got.map((a) => `${a.type}:${a.session ?? a.tool}`)).toEqual(['prompt:c1', 'prompt:c3', 'tool:WebSearch'])
  })

  it('Claude Code gọi `agy` qua Bash → đánh dấu launches', () => {
    const t = new Translator()
    const out = t.translate({ type: 'assistant', message: { id: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'cd tmp && agy -p "$(cat PLAN.md)"', description: 'Giao plan cho agy' } }] } }, 'task-dispatcher')
    expect(out).toEqual([{ type: 'tool', agent: 'task-dispatcher', tool: 'Bash', summary: 'Giao plan cho agy', launches: 'antigravity' }])
  })
})
