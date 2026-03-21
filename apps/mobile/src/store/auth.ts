import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type { AuthResponse } from '@housekeeping/shared'

interface AuthState {
  token: string | null
  user: AuthResponse['user'] | null
  setAuth: (data: AuthResponse) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: async (data) => {
        await SecureStore.setItemAsync('hk_token', data.accessToken)
        set({ token: data.accessToken, user: data.user })
      },
      logout: async () => {
        await SecureStore.deleteItemAsync('hk_token')
        set({ token: null, user: null })
      },
    }),
    {
      name: 'hk-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
    },
  ),
)
