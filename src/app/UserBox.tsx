'use client';

import { signOut, useAuthStore } from '@/store/useAuthStore';

export default function UserBox() {
  const { user, tenantId, role } = useAuthStore();

  if (!user) return null;

  return (
    <div className="mt-4 border-t pt-4 text-xs">
      <div className="font-semibold">{user.email}</div>
      <div className="text-slate-500">
        {tenantId ?? '—'} · {role ?? 'viewer'}
      </div>
      <button
        onClick={() => signOut()}
        className="mt-2 px-3 py-1 rounded bg-slate-900 text-white font-bold"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
