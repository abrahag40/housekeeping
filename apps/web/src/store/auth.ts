import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthResponse } from '@housekeeping/shared'
import { usePropertyStore } from './property'

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
      setAuth: (data) => {
        localStorage.setItem('hk_token', data.accessToken)
        set({ token: data.accessToken, user: data.user })
      },
      logout: () => {
        localStorage.removeItem('hk_token')
        usePropertyStore.getState().reset()
        set({ token: null, user: null })
      },
    }),
    { name: 'hk_auth' },
  ),
)
