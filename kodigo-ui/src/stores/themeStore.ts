import { create } from 'zustand';

type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  initializeTheme: () => void;
}

const STORAGE_KEY = 'kodigo-theme';

const applyTheme = (mode: ThemeMode) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'light',
  setMode: (mode) => {
    applyTheme(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
    set({ mode });
  },
  toggleMode: () => {
    const nextMode = get().mode === 'dark' ? 'light' : 'dark';
    applyTheme(nextMode);
    window.localStorage.setItem(STORAGE_KEY, nextMode);
    set({ mode: nextMode });
  },
  initializeTheme: () => {
    if (typeof window === 'undefined') return;
    const storedMode = window.localStorage.getItem(STORAGE_KEY);
    const preferredMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const mode: ThemeMode = storedMode === 'dark' || storedMode === 'light' ? storedMode : preferredMode;
    applyTheme(mode);
    set({ mode });
  },
}));
