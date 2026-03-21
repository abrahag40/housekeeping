import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import type { CleaningTaskDto, SyncOperation } from '@housekeeping/shared'
import { api } from '../api/client'

interface TaskStore {
  tasks: CleaningTaskDto[]
  loading: boolean
  syncQueue: SyncOperation[]

  fetchTasks: () => Promise<void>
  startTask: (taskId: string) => Promise<void>
  endTask: (taskId: string) => Promise<void>
  flushQueue: () => Promise<void>
}

function applyOptimistic(
  tasks: CleaningTaskDto[],
  taskId: string,
  patch: Partial<CleaningTaskDto>,
): CleaningTaskDto[] {
  return tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      loading: false,
      syncQueue: [],

      fetchTasks: async () => {
        set({ loading: true })
        try {
          const tasks = await api.get<CleaningTaskDto[]>(
            '/tasks?status=PENDING,READY,UNASSIGNED,IN_PROGRESS,PAUSED,DONE',
          )
          set({ tasks, loading: false })
        } catch {
          set({ loading: false })
        }
      },

      startTask: async (taskId) => {
        // Optimistic update
        set((s) => ({
          tasks: applyOptimistic(s.tasks, taskId, { status: 'IN_PROGRESS', startedAt: new Date().toISOString() }),
        }))

        const netState = await NetInfo.fetch()
        if (netState.isConnected) {
          await api.patch(`/tasks/${taskId}/start`)
        } else {
          // Queue for later sync
          const op: SyncOperation = {
            id: `${Date.now()}-start-${taskId}`,
            type: 'START_TASK',
            taskId,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          }
          set((s) => ({ syncQueue: [...s.syncQueue, op] }))
        }
      },

      endTask: async (taskId) => {
        set((s) => ({
          tasks: applyOptimistic(s.tasks, taskId, { status: 'DONE', finishedAt: new Date().toISOString() }),
        }))

        const netState = await NetInfo.fetch()
        if (netState.isConnected) {
          await api.patch(`/tasks/${taskId}/end`)
        } else {
          const op: SyncOperation = {
            id: `${Date.now()}-end-${taskId}`,
            type: 'END_TASK',
            taskId,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          }
          set((s) => ({ syncQueue: [...s.syncQueue, op] }))
        }
      },

      flushQueue: async () => {
        const { syncQueue } = get()
        if (syncQueue.length === 0) return

        const remaining: SyncOperation[] = []

        for (const op of syncQueue) {
          try {
            if (op.type === 'START_TASK') {
              await api.patch(`/tasks/${op.taskId}/start`)
            } else if (op.type === 'END_TASK') {
              await api.patch(`/tasks/${op.taskId}/end`)
            }
          } catch {
            if (op.retryCount < 5) {
              remaining.push({ ...op, retryCount: op.retryCount + 1 })
            }
          }
        }

        set({ syncQueue: remaining })

        // Re-fetch to get server state after sync
        if (remaining.length < syncQueue.length) {
          await get().fetchTasks()
        }
      },
    }),
    {
      name: 'hk-tasks',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ tasks: state.tasks, syncQueue: state.syncQueue }),
    },
  ),
)
