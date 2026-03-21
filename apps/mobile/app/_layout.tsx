import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useAuthStore } from '../src/store/auth'
import { registerForPushNotificationsAsync, setupNotificationListeners } from '../src/notifications'
import { startSyncManager, stopSyncManager } from '../src/syncManager'

export default function RootLayout() {
  const { token } = useAuthStore()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    const inAuthGroup = segments[0] === '(auth)'
    if (!token && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (token && inAuthGroup) {
      router.replace('/(app)/rooms')
    }
  }, [token, segments])

  useEffect(() => {
    if (token) {
      registerForPushNotificationsAsync()
      startSyncManager()
      const cleanup = setupNotificationListeners(({ taskId }) => {
        if (taskId) router.push(`/(app)/task/${taskId}`)
      })
      return () => {
        cleanup()
        stopSyncManager()
      }
    }
  }, [token])

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="dark" />
    </>
  )
}
