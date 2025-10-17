'use client';
import { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { getIdToken } from 'firebase/auth';

export default function UsuariosPage(){
  const { tenantId, user } = useAuthStore();
  const [form, setForm] = useState({ usuario:'', pin:'', nombre:'', rutaId:'', ciudad:'', role:'collector' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function crearUsuario(e: React.FormEvent){
    e.preventDefault(); setLoading(true); setMsg('');
    try {
      const idToken = user ? await getIdToken(user, true) : '';
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ ...form, tenantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Error');
      setMsg(`✅ Creado (uid: ${data.uid}) — Login: ${form.usuario} / PIN: ${form.pin}`);
      setForm({ usuario:'', pin:'', nombre:'', rutaId:'', ciudad:'', role:'collector' });
    } catch (err:any) {
      setMsg(`❌ ${err.message}`);
    } finally { setLoading(false); }
  }

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="font-bold text-xl">Crear usuario (cobrador)</h2>
      <form onSubmit={crearUsuario} className="grid grid-cols-2 gap-3">
        <input className="border rounded p-2" placeholder="Usuario (ej: Ruta1)"
          value={form.usuario} onChange={e=>setForm(s=>({...s, usuario:e.target.value}))} />
        <input className="border rounded p-2" placeholder="PIN (mín. 6 dígitos)" type="password"
          value={form.pin} onChange={e=>setForm(s=>({...s, pin:e.target.value}))} />
        <input className="border rounded p-2" placeholder="Nombre"
          value={form.nombre} onChange={e=>setForm(s=>({...s, nombre:e.target.value}))} />
        <input className="border rounded p-2" placeholder="Ruta ID"
          value={form.rutaId} onChange={e=>setForm(s=>({...s, rutaId:e.target.value}))} />
        <input className="border rounded p-2 col-span-2" placeholder="Ciudad"
          value={form.ciudad} onChange={e=>setForm(s=>({...s, ciudad:e.target.value}))} />
        <select className="border rounded p-2 col-span-2" value={form.role}
          onChange={e=>setForm(s=>({...s, role:e.target.value}))}>
          <option value="collector">collector</option>
          <option value="admin">admin</option>
          <option value="superadmin">superadmin</option>
        </select>
        <button disabled={loading} className="bg-emerald-600 text-white rounded p-2 font-bold col-span-2">
          {loading ? 'Creando…' : 'Crear usuario'}
        </button>
      </form>
      {!!msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
