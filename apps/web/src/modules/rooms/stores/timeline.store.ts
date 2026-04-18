import { create } from 'zustand'
import { startOfDay, subDays, addDays } from 'date-fns'
import { TIMELINE } from '../utils/timeline.constants'
import type { ViewMode } from '../types/timeline.types'

interface DragState {
  stayId: string
  originalRoomId: string
  originalCheckIn: Date
  currentRoomId: string
  currentCheckIn: Date
  offsetDays: number
}

interface TimelineStore {
  viewStart: Date
  viewMode: ViewMode
  dayWidth: number
  daysVisible: number
  dragging: DragState | null
  selectedStayId: string | null
  hoveredDate: Date | null
  sheetOpen: boolean
  sheetStayId: string | null

  setViewMode: (mode: ViewMode) => void
  navigate: (direction: 'prev' | 'next') => void
  goToToday: () => void
  setDragging: (state: DragState | null) => void
  selectStay: (id: string | null) => void
  setViewStartDirect: (date: Date) => void
  openSheet: (stayId: string) => void
  closeSheet: () => void
}

const DAYS_BY_MODE: Record<ViewMode, number> = {
  week: 14,
  month: 30,
  quarter: 90,
}

export const useTimelineStore = create<TimelineStore>((set) => ({
  viewStart: subDays(startOfDay(new Date()), 2),
  viewMode: 'month',
  dayWidth: TIMELINE.DAY_WIDTH.month,
  daysVisible: 30,
  dragging: null,
  selectedStayId: null,
  hoveredDate: null,
  sheetOpen: false,
  sheetStayId: null,

  setViewMode: (mode) => set({
    viewMode: mode,
    dayWidth: TIMELINE.DAY_WIDTH[mode],
    daysVisible: DAYS_BY_MODE[mode],
  }),

  navigate: (direction) => set((state) => {
    const step = Math.floor(state.daysVisible / 2)
    const days = direction === 'next' ? step : -step
    return {
      viewStart: addDays(state.viewStart, days),
    }
  }),

  goToToday: () => set({
    viewStart: subDays(startOfDay(new Date()), 2),
  }),

  setViewStartDirect: (date) => set({ viewStart: date }),
  setDragging: (dragging) => set({ dragging }),
  selectStay: (id) => set({ selectedStayId: id }),
  openSheet: (stayId) => set({ sheetOpen: true, sheetStayId: stayId }),
  closeSheet: () => set({ sheetOpen: false, sheetStayId: null }),
}))
