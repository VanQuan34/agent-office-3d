import { create } from 'zustand'
import type { DeptId, FeedItem } from './sim/types'

interface UIState {
  /** 0 = tạm dừng */
  speed: number
  selected: DeptId | null
  /** tăng ~4 lần/giây để panel React đọc lại trạng thái engine */
  tick: number
  feed: FeedItem[]
  showLabels: boolean
  setSpeed: (s: number) => void
  select: (id: DeptId | null) => void
  toggleLabels: () => void
  refresh: (feed: FeedItem[]) => void
}

export const useUI = create<UIState>((set) => ({
  speed: 1,
  selected: null,
  tick: 0,
  feed: [],
  showLabels: true,
  setSpeed: (speed) => set({ speed }),
  select: (selected) => set({ selected }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  refresh: (feed) => set((s) => ({ tick: s.tick + 1, feed })),
}))
