import { create } from 'zustand';
import { onAuthStateChanged, User, signOut as fbSignOut, getIdTokenResult } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type Role = 'viewer' | 'admin' | 'superadmin' | undefined;

type State = {
  user: User | null;
  loading: boolean;
  tenantId?: string;
  role?: Role;
};
export const useAuthStore = create<State>(() => ({ user: null, loading: true }));

let booted = false;
export function initAuthListener() {
  if (booted) return; booted = true;
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      useAuthStore.setState({ user: null, loading: false, tenantId: undefined, role: undefined });
      return;
    }

    // 1) Intentar leer custom claims (tenantId/role)
    let tenantId: string | undefined;
    let role: Role = undefined;
    try {
      const token = await getIdTokenResult(user, true);
      tenantId = token.claims?.tenantId as string | undefined;
      role = token.claims?.role as Role;
    } catch { /* noop */ }

    // 2) Si no hay claims, leer perfil Firestore: usuarios/{uid}
    if (!tenantId || !role) {
      try {
        const snap = await getDoc(doc(db, 'usuarios', user.uid));
        if (snap.exists()) {
          const data = snap.data() as { tenantId?: string; role?: Role };
          tenantId = tenantId ?? data.tenantId;
          role = role ?? data.role;
        }
      } catch { /* noop */ }
    }

    useAuthStore.setState({ user, loading: false, tenantId, role });
  });
}

export async function signOut() {
  await fbSignOut(auth);
  useAuthStore.setState({ user: null, loading: false, tenantId: undefined, role: undefined });
}
