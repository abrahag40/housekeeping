import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PropertyState {
  activePropertyId: string | null
  activePropertyName: string | null
  setActiveProperty: (id: string, name: string) => void
  reset: () => void
}

export const usePropertyStore = create<PropertyState>()(
  persist(
    (set) => ({
      activePropertyId: null,
      activePropertyName: null,
      setActiveProperty: (id, name) => set({ activePropertyId: id, activePropertyName: name }),
      reset: () => set({ activePropertyId: null, activePropertyName: null }),
    }),
    { name: 'hk_property' },
  ),
)
