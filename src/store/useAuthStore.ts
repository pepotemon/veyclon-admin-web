import { create } from 'zustand';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';


type State = { user: User | null; loading: boolean; tenantId?: string; role?: string };
export const useAuthStore = create<State>(() => ({ user: null, loading: true }));


let booted = false;
export function initAuthListener(){
if(booted) return; booted = true;
onAuthStateChanged(auth, async (user) => {
useAuthStore.setState({ user, loading: false, tenantId: undefined, role: undefined });
// TODO: leer perfil/claims si guardas tenantId/role en Firestore o en Custom Claims
});
}