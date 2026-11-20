import { QUALITY, switchPreset } from '../quality'
import { formatClock } from '../sim/engine'
import { DEPARTMENTS, DEPT_BY_ID } from '../sim/layout'
import type { FeedKind } from '../sim/types'
import { CONFIG, IS_LIVE } from '../config'
import { engine, liveSource } from '../simInstance'
import { useUI } from '../store'

export function HUD() {
  return (
    <div className="hud">
      <TopBar />
      <DeptPanel />
      <ActivityFeed />
      <div className="hint">Kéo chuột trái để xoay · chuột phải để di chuyển · cuộn để zoom · click nhân viên để theo dõi · Esc để bỏ chọn</div>
    </div>
  )
}

const SPEEDS = [0, 1, 2, 5]

function TopBar() {
  useUI((s) => s.tick)
  const speed = useUI((s) => s.speed)
  const setSpeed = useUI((s) => s.setSpeed)
  const showLabels = useUI((s) => s.showLabels)
  const toggleLabels = useUI((s) => s.toggleLabels)
  const active = [...engine.tasks.values()].filter((t) => t.status !== 'done').length
  const meeting = [...engine.meetings.values()].find((m) => m.startedAt !== null && !m.ended)
  return (
    <header className="panel topbar">
      <div className="brand">
        <span className="logo">◆</span> Agent Office <ModeTag />
      </div>
      <div className="stats">
        <Stat label={IS_LIVE ? 'Giờ' : 'Giờ văn phòng'} value={IS_LIVE ? clockOf(Date.now()) : formatClock(engine.time)} />
        <Stat label="Việc đang chạy" value={String(active)} />
        <Stat label="Quy trình hoàn tất" value={String(engine.completedCount)} />
        <Stat label="Phòng họp" value={meeting ? meeting.topic : 'Trống'} />
      </div>
      <div className="controls">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)} title={s ? `Tốc độ ${s}x` : 'Tạm dừng'}>
            {s === 0 ? '⏸' : `${s}x`}
          </button>
        ))}
        <button className={showLabels ? 'on' : ''} onClick={toggleLabels} title="Bật/tắt nhãn">
          🏷
        </button>
        <button
          onClick={() => switchPreset(QUALITY.preset === 'high' ? 'low' : 'high')}
          title="Chất lượng đồ hoạ (Cao: AO + khử răng cưa, cần card rời)"
        >
          {QUALITY.preset === 'high' ? 'Cao' : 'Nhẹ'}
        </button>
        <a className="btn-link" href="?view=character" title="Xem mẫu nhân vật Người Mầm, xuất GLB">
          Nhân vật
        </a>
      </div>
    </header>
  )
}

function ModeTag() {
  useUI((s) => s.tick)
  if (!IS_LIVE) return <span className="tag">Mô phỏng</span>
  const st = liveSource?.status ?? 'offline'
  const label = st === 'live' ? (CONFIG.mode === 'replay' ? 'Phát lại' : 'LIVE') : st === 'connecting' ? 'Đang kết nối' : 'Mất kết nối'
  return (
    <>
      <span className={`tag live ${st}`} title={liveSource?.lastStatus}>
        ● {label}
      </span>
      {CONFIG.project && (
        <span className="project" title={CONFIG.project.path}>
          {CONFIG.project.name}
        </span>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  )
}

function DeptPanel() {
  useUI((s) => s.tick)
  const selected = useUI((s) => s.selected)
  const select = useUI((s) => s.select)
  return (
    <aside className="panel depts">
      <h3>Phòng ban</h3>
      {DEPARTMENTS.map((d) => {
        const a = engine.agentById[d.id]
        const cur = a.currentTaskId ? engine.tasks.get(a.currentTaskId) : undefined
        const queue = [...engine.tasks.values()].filter((t) => t.dept === d.id && t.status === 'queued')
        const isSel = selected === d.id
        return (
          <div
            key={d.id}
            className={`dept ${isSel ? 'sel' : ''}`}
            style={{ ['--c' as string]: d.color }}
            onClick={() => select(isSel ? null : d.id)}
          >
            <div className="row">
              <span className="dot" />
              <b>{d.name}</b>
              <span className="who">{d.agentName}</span>
              {queue.length > 0 && <span className="badge">{queue.length} chờ</span>}
            </div>
            <div className="activity">{a.activity}</div>
            {cur && (
              <div className="progress">
                <div style={{ width: `${Math.round(cur.progress * 100)}%` }} />
              </div>
            )}
            {isSel && (
              <div className="detail">
                <div className="muted">{d.role}</div>
                {queue.length > 0 && (
                  <ul>
                    {queue.map((t) => (
                      <li key={t.id}>
                        {t.title} <span className="muted">· {t.workflow}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <AgentLog dept={d.id} />
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}

const KIND_ICON: Record<FeedKind, string> = { task: '📝', handoff: '📨', meeting: '📅', done: '✅', info: 'ℹ️' }

/** Nhật ký riêng của một agent (10 dòng gần nhất) */
function AgentLog({ dept }: { dept: string }) {
  const feed = useUI((s) => s.feed)
  const mine = engine.feed.filter((f) => f.dept === dept).slice(-10).reverse()
  void feed // render lại theo nhịp cập nhật nhật ký
  if (!mine.length) return <div className="muted agent-log-empty">Chưa có hoạt động</div>
  return (
    <div className="agent-log">
      <div className="label">Nhật ký</div>
      {mine.map((f) => (
        <div key={f.id} className="row-log">
          <span className="time">{f.at ? clockOf(f.at, true) : formatClock(f.time)}</span>
          <span>{f.text.replace(/^[^:]{1,40}: /, '')}</span>
        </div>
      ))}
    </div>
  )
}

const clockOf = (ms: number, sec = false) =>
  new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hour12: false })

function ActivityFeed() {
  const feed = useUI((s) => s.feed)
  const empty = IS_LIVE && feed.length === 0
  return (
    <aside className="panel feed">
      <h3>Hoạt động</h3>
      {empty && (
        <div className="empty-hint">
          Chưa có hoạt động.
          <br />
          Mở Claude Code trong project <b>{CONFIG.project?.name}</b> và gửi yêu cầu – hoạt động của agent sẽ hiện ở đây theo thời gian thực.
          {liveSource?.lastStatus && <div className="muted">{liveSource.lastStatus}</div>}
        </div>
      )}
      <div className="items">
        {[...feed].reverse().map((f) => (
          <div key={f.id} className={`item k-${f.kind}`} style={{ ['--c' as string]: f.dept ? DEPT_BY_ID[f.dept].color : '#8892a0' }}>
            <span className="time">{f.at ? clockOf(f.at, true) : formatClock(f.time)}</span>
            <span className="ico">{KIND_ICON[f.kind]}</span>
            <span className="txt">{f.text}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
