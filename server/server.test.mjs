import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildRoster, findTranscriptDir, parseFrontmatter } from './discover.mjs'
import { promptText, recentHistory, sessionTimeline, summarizeTool, TranscriptWatcher, Translator } from './transcripts.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const line = (o) => JSON.stringify(o) + '\n'
const ts = (s) => `2026-11-20T10:00:${String(s).padStart(2, '0')}.000Z`
const user = (text, s, extra = {}) => ({ type: 'user', sessionId: 'S1', timestamp: ts(s), message: { role: 'user', content: text }, ...extra })
const asst = (content, s, stop = 'tool_use', id = `m${s}`) => ({ type: 'assistant', sessionId: 'S1', timestamp: ts(s), message: { id, content, stop_reason: stop } })
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input })
const toolResult = (id, s, res) => ({ type: 'user', timestamp: ts(s), message: { content: [{ type: 'tool_result', tool_use_id: id }] }, toolUseResult: res })

describe('discover', () => {
  it('đọc frontmatter agent (kể cả mô tả nhiều dòng)', () => {
    const fm = parseFrontmatter('---\nname: test-runner\nmodel: haiku\ndescription: |\n  Chạy gate\n  kiểm tra\ntools: Bash, Read\n---\nnội dung')
    expect(fm).toMatchObject({ name: 'test-runner', model: 'haiku', tools: 'Bash, Read' })
    expect(fm.description).toBe('Chạy gate\nkiểm tra')
  })

  it('tìm thư mục transcript theo quy ước của Claude Code, không phân biệt hoa thường', () => {
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'My Proj')
    fs.mkdirSync(path.join(home, 'projects', path.resolve(project).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()), { recursive: true })
    expect(findTranscriptDir(project, home)).not.toBeNull()
  })

  it('roster = agent chính + .claude/agents + agent từng chạy', () => {
    const project = path.join(tmp, 'proj')
    fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(project, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Review code\ncolor: purple\n---\n')
    fs.writeFileSync(path.join(project, '.claude', 'agents', 'README.md'), '# không phải agent')
    const tx = path.join(tmp, 'tx-roster')
    fs.mkdirSync(path.join(tx, 'S9', 'subagents'), { recursive: true })
    fs.writeFileSync(path.join(tx, 'S9', 'subagents', 'agent-a.meta.json'), JSON.stringify({ agentType: 'Explore' }))
    const r = buildRoster(project, { txDir: tx, claudeHome: path.join(tmp, 'nohome') })
    expect(r.map((a) => a.key)).toEqual(['main', 'reviewer', 'Explore'])
    expect(r[2].builtIn).toBe(true)
  })
})

describe('Translator', () => {
  it('prompt → tool → giao việc đồng bộ → kết quả → kết thúc lượt', () => {
    const t = new Translator()
    const all = [
      ...t.translate(user('<system-reminder>bỏ qua</system-reminder>Sửa lỗi đăng nhập', 0), 'main'),
      ...t.translate(user('nội bộ', 1, { isMeta: true }), 'main'),
      ...t.translate(asst([toolUse('r1', 'Read', { file_path: 'D:/x/src/login.ts' })], 2), 'main'),
      ...t.translate(asst([toolUse('A1', 'Agent', { subagent_type: 'reviewer', description: 'Review fix' })], 3), 'main'),
      ...t.translate(toolResult('A1', 9, { status: 'completed' }), 'main'),
      ...t.translate(asst([{ type: 'text', text: 'xong' }], 10, 'end_turn'), 'main'),
      ...t.translate(asst([{ type: 'text', text: 'xong' }], 10, 'end_turn'), 'main'), // dòng lặp cùng message id
    ]
    expect(all).toEqual([
      { type: 'prompt', session: 'S1', text: 'Sửa lỗi đăng nhập' },
      { type: 'tool', agent: 'main', tool: 'Read', summary: 'Read login.ts' },
      { type: 'delegate', id: 'A1', from: 'main', to: 'reviewer', description: 'Review fix' },
      { type: 'delegate_done', id: 'A1' },
      { type: 'turn_end', session: 'S1' },
    ])
  })

  it('subagent chạy nền: chỉ xong khi meta báo finished', () => {
    const t = new Translator()
    t.translate(asst([toolUse('B1', 'Agent', { subagent_type: 'x', description: 'd' })], 1), 'main')
    expect(t.translate(toolResult('B1', 2, { status: 'async_launched', isAsync: true }), 'main')).toEqual([])
    expect(t.isWaitingAsync('B1')).toBe(true)
    expect(t.finish('B1')).toEqual({ type: 'delegate_done', id: 'B1' })
    expect(t.finish('B1')).toBeNull()
  })

  it('tóm tắt tool + lọc prompt', () => {
    expect(summarizeTool('Bash', { command: 'npm test\nmore', description: '' })).toBe('npm test')
    expect(summarizeTool('mcp__figma__get_node', {})).toBe('figma › get_node')
    expect(promptText([{ type: 'text', text: '<command-name>/x</command-name> chạy test' }])).toBe('chạy test')
  })
})

describe('transcript trên đĩa', () => {
  const tx = path.join(tmp, 'tx')
  const sub = path.join(tx, 'S1', 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(
    path.join(tx, 'S1.jsonl'),
    [
      user('Kiểm tra API', 0),
      asst([toolUse('A1', 'Agent', { subagent_type: 'api-audit', description: 'Audit API', run_in_background: true })], 1),
      toolResult('A1', 2, { status: 'async_launched', isAsync: true }),
    ]
      .map(line)
      .join(''),
  )
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ agentType: 'api-audit', toolUseId: 'A1', finished: true }))
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'), [user('prompt nội bộ', 3, { isSidechain: true }), asst([toolUse('g', 'Grep', { pattern: 'fetch(' })], 5)].map(line).join(''))

  it('dòng thời gian phát lại gộp phiên chính + subagent theo thời gian', () => {
    const tl = sessionTimeline(tx, 'S1').map((x) => x.a.type + (x.a.agent ? ':' + x.a.agent : ''))
    expect(tl).toEqual(['prompt', 'delegate', 'tool:api-audit', 'delegate_done'])
  })

  it('lịch sử gần nhất để nạp nhật ký lúc mở', () => {
    const h = recentHistory(tx, 3)
    expect(h.session).toBe('S1')
    expect(h.items.map((x) => x.a.type)).toEqual(['delegate', 'tool', 'delegate_done'])
    expect(typeof h.items[0].at).toBe('number')
  })

  it('watcher không phát lại file transcript cũ (lỗi: file > 12h bị đọc lại từ đầu ở lượt quét sau)', async () => {
    const old = path.join(tmp, 'tx-old')
    fs.mkdirSync(old, { recursive: true })
    const f = path.join(old, 'OLD.jsonl')
    fs.writeFileSync(f, [user('cũ', 0), asst([toolUse('r', 'Read', { file_path: 'a.ts' })], 1)].map(line).join(''))
    const twoDaysAgo = (Date.now() - 48 * 3600_000) / 1000
    fs.utimesSync(f, twoDaysAgo, twoDaysAgo)
    const got = []
    const w = new TranscriptWatcher(old, { pollMs: 20 })
    w.on('activity', (a) => got.push(a))
    w.start()
    await new Promise((r) => setTimeout(r, 120))
    expect(got).toEqual([])
    fs.appendFileSync(f, line(asst([toolUse('e', 'Edit', { file_path: 'b.ts' })], 2)))
    await new Promise((r) => setTimeout(r, 80))
    w.stop()
    expect(got.map((a) => a.summary)).toEqual(['Edit b.ts'])
  })

  it('watcher live: chỉ phát phần ghi thêm, đọc subagent mới và cờ finished', async () => {
    const got = []
    const w = new TranscriptWatcher(tx, { pollMs: 20 })
    w.on('activity', (a) => got.push(a))
    w.start()
    await new Promise((r) => setTimeout(r, 80))
    expect(got).toEqual([]) // lịch sử cũ không phát lại
    fs.appendFileSync(path.join(tx, 'S1.jsonl'), line(asst([toolUse('A2', 'Agent', { subagent_type: 'reviewer', description: 'R' })], 20)))
    fs.mkdirSync(path.join(tx, 'S1', 'subagents'), { recursive: true })
    fs.writeFileSync(path.join(sub, 'agent-y.meta.json'), JSON.stringify({ agentType: 'reviewer', toolUseId: 'A2', finished: false }))
    fs.writeFileSync(path.join(sub, 'agent-y.jsonl'), line(asst([toolUse('e', 'Edit', { file_path: '/a/b.ts' })], 21)))
    await new Promise((r) => setTimeout(r, 120))
    fs.appendFileSync(path.join(tx, 'S1.jsonl'), line(toolResult('A2', 22, { status: 'completed' })))
    await new Promise((r) => setTimeout(r, 120))
    w.stop()
    expect(got.map((a) => a.type + ':' + (a.agent ?? a.to ?? a.id))).toEqual(['delegate:reviewer', 'tool:reviewer', 'delegate_done:A2'])
  })
})

describe('CLI', () => {
  it('bỏ qua chú thích "#" lỡ dán vào lệnh và báo lỗi thư mục không tồn tại', async () => {
    const { execFileSync } = await import('node:child_process')
    const bin = path.resolve(import.meta.dirname, '..', 'bin', 'agent-office.mjs')
    const proj = path.join(tmp, 'proj')
    const out = execFileSync(process.execPath, [bin, 'agents', proj, '#', 'theo', 'dõi', 'live'], { encoding: 'utf8' })
    expect(out).toContain(`Project: ${proj}`)
    expect(out).toContain('reviewer')
    let err = ''
    try {
      execFileSync(process.execPath, [bin, 'agents', path.join(tmp, 'khong-co')], { encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      err = String(e.stderr)
    }
    expect(err).toContain('Không tìm thấy thư mục project')
  })
})
