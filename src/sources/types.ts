import type { Engine } from '../sim/engine'

/**
 * Nguồn dữ liệu cho engine. Mock (giả lập) và backend thật (WebSocket/REST) đều cài interface này
 * và chỉ giao tiếp với engine qua `engine.dispatch(SimEvent)` + `engine.onNotice(...)`.
 */
export interface EventSource {
  attach(engine: Engine): void
  /** gọi mỗi tick với dt theo thời gian mô phỏng (đã nhân tốc độ) */
  update?(dt: number): void
  detach?(): void
}
