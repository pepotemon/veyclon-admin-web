'use client';

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';

type FiltersState = {
  from: string;              // YYYY-MM-DD
  to: string;                // YYYY-MM-DD
  rutaId: string | null;
  cobradorId: string | null;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setRutaId: (v: string | null) => void;
  setCobradorId: (v: string | null) => void;
  setMany: (patch: Partial<Omit<FiltersState, ActionKeys>>) => void;
  reset: () => void;
};

type ActionKeys =
  | 'setFrom'
  | 'setTo'
  | 'setRutaId'
  | 'setCobradorId'
  | 'setMany'
  | 'reset';

const initialState: Pick<FiltersState, 'from' | 'to' | 'rutaId' | 'cobradorId'> = {
  from: '',
  to: '',
  rutaId: null,
  cobradorId: null,
};

// Fallback en memoria para SSR/entornos sin window
const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const storageFactory = (): StateStorage =>
  typeof window !== 'undefined' ? window.localStorage : memoryStorage;

// Store vanilla (Zustand v5)
export const filtersStore = createStore<FiltersState>()(
  persist(
    (set) => ({
      ...initialState,
      setFrom: (v) => set({ from: v }),
      setTo: (v) => set({ to: v }),
      setRutaId: (v) => set({ rutaId: v }),
      setCobradorId: (v) => set({ cobradorId: v }),
      setMany: (patch) => set(patch),
      reset: () => set({ ...initialState }),
    }),
    {
      name: 'filters:v1',
      storage: createJSONStorage(storageFactory),
      partialize: (s) => ({
        from: s.from,
        to: s.to,
        rutaId: s.rutaId,
        cobradorId: s.cobradorId,
      }),
    }
  )
);

// Hook tipado — sin equality arg (para tu versión de zustand v5)
export function useFiltersStore<T>(selector: (s: FiltersState) => T): T {
  return useStore(filtersStore, selector);
}

export type FiltersStore = typeof filtersStore;
