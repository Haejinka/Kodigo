import { create } from 'zustand';
import type { User, UserRole } from '@/types';
import { mockUsers } from '@/lib/mock-data';

interface AuthState {
  user: User | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  role: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email: string, _password: string) => {
    set({ isLoading: true, error: null });
    await new Promise((r) => setTimeout(r, 800)); // simulate network

    const found = mockUsers.find((u) => u.email === email);
    if (!found) {
      set({ isLoading: false, error: 'Invalid email or password.' });
      return;
    }

    set({ user: found, role: found.role, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    set({ user: null, role: null, isAuthenticated: false });
  },
}));
