import NetInfo from '@react-native-community/netinfo'
import { useTaskStore } from './store/tasks'

let unsubscribe: (() => void) | null = null

export function startSyncManager() {
  if (unsubscribe) return // already running

  unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable) {
      const { syncQueue, flushQueue } = useTaskStore.getState()
      if (syncQueue.length > 0) {
        flushQueue()
      }
    }
  })
}

export function stopSyncManager() {
  unsubscribe?.()
  unsubscribe = null
}
