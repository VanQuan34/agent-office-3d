import { CONFIG, IS_LIVE } from './config'
import { Engine } from './sim/engine'
import { LiveSource } from './sources/liveSource'
import { MockSource } from './sources/mockSource'
import type { EventSource } from './sources/types'

/**
 * Một engine dùng chung cho cả scene 3D và UI.
 * - live/replay (chạy bằng CLI): nhận hoạt động thật của agent Claude Code qua SSE
 * - mock (npm run dev): kịch bản giả lập
 */
export const engine = new Engine({ realTime: IS_LIVE })
export const liveSource = IS_LIVE ? new LiveSource(CONFIG.eventsUrl ?? '/api/events') : null
export const source: EventSource = liveSource ?? new MockSource()
source.attach(engine)
