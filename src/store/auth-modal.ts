import { create } from 'zustand'

export type AuthModalMode = 'login' | 'register' | 'forgot-password'

interface AuthModalState {
  open: boolean
  mode: AuthModalMode
  returnTo: string
  show: (mode?: AuthModalMode, returnTo?: string) => void
  setMode: (mode: AuthModalMode) => void
  close: () => void
}

function safeReturnTo(value?: string): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export const useAuthModal = create<AuthModalState>((set) => ({
  open: false,
  mode: 'login',
  returnTo: '/',
  show: (mode = 'login', returnTo = '/') => set({ open: true, mode, returnTo: safeReturnTo(returnTo) }),
  setMode: (mode) => set({ mode }),
  close: () => set({ open: false }),
}))
