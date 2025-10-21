'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { getAuth, getIdToken } from 'firebase/auth';

type Role = 'collector' | 'admin' | 'superadmin';

type CreateUserBody = {
  usuario: string;
  pin: string;
  nombre?: string;
  rutaId?: string;
  ciudad?: string;
  role: Role;
  tenantId?: string | null;
};

function normUsuario(u: string) {
  return String(u || '').trim().toLowerCase();
}

export default function UsuariosPage() {
  const { tenantId, user, role: myRole } = useAuthStore();
  const [form, setForm] = useState<CreateUserBody>({
    usuario: '',
    pin: '',
    nombre: '',
    rutaId: '',
    ciudad: '',
    role: 'collector',          // default seguro
    tenantId: tenantId ?? undefined,
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');

  // Roles permitidos según quién está logueado
  const allowedRoles: Role[] = useMemo(() => {
    if (myRole === 'superadmin') return ['admin', 'collector'];
    if (myRole === 'admin') return ['collector'];
    return []; // nadie más debería llegar aquí por el guard del layout
  }, [myRole]);

  // Si el rol del form no está permitido, fuerzo uno válido
  useEffect(() => {
    if (!allowedRoles.includes(form.role)) {
      setForm((s) => ({ ...s, role: allowedRoles[0] ?? 'collector' }));
    }
  }, [allowedRoles, form.role]);

  const isValid = useMemo(() => {
    return normUsuario(form.usuario).length > 0 && String(form.pin).length >= 6;
  }, [form.usuario, form.pin]);

  async function crearUsuario(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg('');

    try {
      const currentUser = user ?? getAuth().currentUser;
      if (!currentUser) throw new Error('No hay sesión activa');

      const idToken = await getIdToken(currentUser, true);

      const body: CreateUserBody = {
        ...form,
        usuario: normUsuario(form.usuario),
        tenantId: tenantId ?? undefined,
      };

      // Protección extra por si alguien “fuerza” el role desde DevTools
      if (!allowedRoles.includes(body.role)) {
        throw new Error('Rol no permitido para tu cuenta');
      }

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });

      const data: { ok?: boolean; uid?: string; email?: string; error?: string } = await res.json();

      if (!res.ok || !data.ok) {
        if (res.status === 401) throw new Error('No autenticado (401). Vuelve a iniciar sesión.');
        if (res.status === 403) throw new Error(data?.error || 'Sin permisos (403).');
        throw new Error(data?.error || 'Error al crear usuario');
      }

      setMsg(`✅ Usuario creado (uid: ${data.uid}) — Login: ${body.usuario} / PIN: ${form.pin}`);
      setForm({
        usuario: '',
        pin: '',
        nombre: '',
        rutaId: '',
        ciudad: '',
        role: allowedRoles[0] ?? 'collector',
        tenantId: tenantId ?? undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMsg(`❌ ${message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="font-bold text-xl">Crear usuario</h2>

      {tenantId && (
        <p className="text-xs text-slate-600">
          Tenant actual: <span className="font-mono">{tenantId}</span>
        </p>
      )}

      <form onSubmit={crearUsuario} className="grid grid-cols-2 gap-3">
        <input
          className="border rounded p-2"
          placeholder="Usuario (ej: ruta1)"
          value={form.usuario}
          onChange={(e) => setForm((s) => ({ ...s, usuario: e.target.value }))}
        />
        <input
          className="border rounded p-2"
          placeholder="PIN (mín. 6 dígitos)"
          type="password"
          value={form.pin}
          onChange={(e) => setForm((s) => ({ ...s, pin: e.target.value }))}
        />
        <input
          className="border rounded p-2"
          placeholder="Nombre"
          value={form.nombre}
          onChange={(e) => setForm((s) => ({ ...s, nombre: e.target.value }))}
        />
        <input
          className="border rounded p-2"
          placeholder="Ruta ID"
          value={form.rutaId}
          onChange={(e) => setForm((s) => ({ ...s, rutaId: e.target.value }))}
        />
        <input
          className="border rounded p-2 col-span-2"
          placeholder="Ciudad"
          value={form.ciudad}
          onChange={(e) => setForm((s) => ({ ...s, ciudad: e.target.value }))}
        />

        {/* Select con opciones limitadas por mi rol */}
        <select
          className="border rounded p-2 col-span-2"
          value={form.role}
          onChange={(e) =>
            setForm((s) => ({ ...s, role: e.target.value as CreateUserBody['role'] }))
          }
        >
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <button
          disabled={loading || !isValid || allowedRoles.length === 0}
          className={`rounded p-2 font-bold col-span-2 text-white ${
            loading || !isValid || allowedRoles.length === 0
              ? 'bg-emerald-400/60 cursor-not-allowed'
              : 'bg-emerald-600'
          }`}
        >
          {loading ? 'Creando…' : 'Crear usuario'}
        </button>
      </form>

      {!!msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
