import { create } from 'zustand';

export type DisplayScale = 90 | 100 | 110;

interface DisplayScaleState {
  scale: DisplayScale;
  userId: string | null;
  initializeForUser: (userId: string | null) => void;
  setScale: (scale: DisplayScale) => void;
}

const storageKey = (userId: string) => `kodigo-display-scale:${userId}`;

const applyScale = (scale: DisplayScale) => {
  if (typeof document === 'undefined') return;
  document.documentElement.style.zoom = `${scale}%`;
};

const readScale = (userId: string | null): DisplayScale => {
  if (!userId || typeof window === 'undefined') return 100;
  const stored = Number(window.localStorage.getItem(storageKey(userId)));
  return stored === 90 || stored === 110 ? stored : 100;
};

export const useDisplayScaleStore = create<DisplayScaleState>((set, get) => ({
  scale: 100,
  userId: null,
  initializeForUser: (userId) => {
    const scale = readScale(userId);
    applyScale(scale);
    set({ userId, scale });
  },
  setScale: (scale) => {
    const { userId } = get();
    if (userId && typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey(userId), String(scale));
    }
    applyScale(scale);
    set({ scale });
  },
}));
