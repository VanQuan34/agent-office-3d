// Khám phá agent của một project Claude Code + thư mục transcript tương ứng.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Agent có sẵn của Claude Code (không nằm trong .claude/agents) */
export const BUILT_IN = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide', 'output-style-setup'])

/** Đọc frontmatter YAML đơn giản (key: value, hỗ trợ khối | và >) */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let [, key, val] = kv
    if (val === '|' || val === '>' || val === '|-' || val === '>-') {
      const buf = []
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) buf.push(lines[++i].trim())
      val = buf.join(val.startsWith('|') ? '\n' : ' ')
    }
    out[key] = val.replace(/^["']|["']$/g, '').trim()
  }
  return out
}

function readAgentDir(dir, source) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'))
    if (!fm?.name) continue
    out.push({ key: fm.name, name: fm.name, description: fm.description, model: fm.model, color: fm.color, source })
  }
  return out
}

/** Agent khai báo trong <project>/.claude/agents/*.md */
export function readProjectAgents(projectDir) {
  return readAgentDir(path.join(projectDir, '.claude', 'agents'), 'project')
}

/** Claude Code lưu transcript ở ~/.claude/projects/<đường dẫn, ký tự đặc biệt → '-'> (không phân biệt hoa thường) */
export function findTranscriptDir(projectDir, claudeHome = path.join(os.homedir(), '.claude')) {
  const root = path.join(claudeHome, 'projects')
  if (!fs.existsSync(root)) return null
  const want = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const hit = fs.readdirSync(root).find((d) => d.toLowerCase() === want)
  return hit ? path.join(root, hit) : null
}

/** Các loại subagent đã từng chạy trong project (đọc *.meta.json của các phiên gần nhất) */
export function seenAgentTypes(txDir, maxSessions = 40) {
  const seen = new Map()
  if (!txDir) return seen
  const sessions = fs
    .readdirSync(txDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(txDir, d.name, 'subagents')))
    .map((d) => ({ dir: path.join(txDir, d.name, 'subagents'), t: fs.statSync(path.join(txDir, d.name)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, maxSessions)
  for (const s of sessions) {
    for (const f of fs.readdirSync(s.dir)) {
      if (!f.endsWith('.meta.json')) continue
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(s.dir, f), 'utf8'))
        if (meta.agentType) seen.set(meta.agentType, (seen.get(meta.agentType) ?? 0) + 1)
      } catch {
        /* meta hỏng – bỏ qua */
      }
    }
  }
  return seen
}

/**
 * Danh sách agent hiển thị: agent chính + agent của project + agent từng xuất hiện trong transcript
 * (agent có sẵn như general-purpose/Explore, hoặc agent cấp user ~/.claude/agents).
 */
export function buildRoster(projectDir, { txDir = findTranscriptDir(projectDir), includeSeen = true, max = 24, claudeHome } = {}) {
  const roster = [{ key: 'main', name: 'Claude', isMain: true, description: 'Agent chính của phiên Claude Code' }]
  const have = new Set(['main'])
  for (const a of readProjectAgents(projectDir)) {
    if (have.has(a.key)) continue
    roster.push(a)
    have.add(a.key)
  }
  if (includeSeen) {
    const userAgents = new Map(readAgentDir(path.join(claudeHome ?? path.join(os.homedir(), '.claude'), 'agents'), 'user').map((a) => [a.key, a]))
    const seen = [...seenAgentTypes(txDir)].sort((a, b) => b[1] - a[1])
    for (const [type] of seen) {
      if (have.has(type)) continue
      const u = userAgents.get(type)
      roster.push(
        u ?? { key: type, name: type, builtIn: BUILT_IN.has(type), description: BUILT_IN.has(type) ? 'Agent có sẵn của Claude Code' : 'Agent cấp user/plugin' },
      )
      have.add(type)
    }
  }
  return roster.slice(0, max)
}
