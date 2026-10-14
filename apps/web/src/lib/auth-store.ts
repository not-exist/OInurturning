import { create } from 'zustand';
import type { MeView } from '@oinur/shared';

interface AuthState {
  me: MeView | null;
  booted: boolean;
  setMe: (me: MeView | null) => void;
  setBooted: (b: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  me: null,
  booted: false,
  setMe: (me) => set({ me }),
  setBooted: (booted) => set({ booted }),
}));
