/**
 * Cấu hình runtime. Khi chạy bằng CLI (`agent-office run`), server chèn
 * `window.__AGENT_OFFICE__` vào index.html trước khi app khởi động.
 * Chạy `npm run dev` không có cấu hình → chế độ mô phỏng (mock).
 */
export interface RosterAgent {
  /** khoá định danh: 'main' cho agent chính, còn lại là subagent_type (vd "test-runner") */
  key: string
  /** tên hiển thị */
  name: string
  description?: string
  model?: string
  /** màu khai báo trong frontmatter (red, blue…) hoặc mã hex */
  color?: string
  isMain?: boolean
  builtIn?: boolean
}

export interface OfficeConfig {
  mode: 'mock' | 'live' | 'replay'
  project?: { name: string; path: string }
  agents?: RosterAgent[]
  /** đường dẫn SSE nhận hoạt động thật */
  eventsUrl?: string
}

declare global {
  interface Window {
    __AGENT_OFFICE__?: OfficeConfig
  }
}

export const CONFIG: OfficeConfig =
  (typeof window !== 'undefined' && window.__AGENT_OFFICE__) || { mode: 'mock' }

export const IS_LIVE = CONFIG.mode !== 'mock' && !!CONFIG.agents?.length
