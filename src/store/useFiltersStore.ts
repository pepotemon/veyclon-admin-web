import { create } from 'zustand';


export type Filters = { from: string; to: string; rutaId?: string; adminUid?: string };
const today = new Date().toISOString().slice(0,10);


export const useFiltersStore = create<{ filters: Filters; setFilters: (p: Partial<Filters>) => void }>((set) => ({
filters: { from: today, to: today },
setFilters: (p) => set((s) => ({ filters: { ...s.filters, ...p } }))
}));