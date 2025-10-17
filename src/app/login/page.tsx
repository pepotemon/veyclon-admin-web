'use client';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function doLogin(e: React.FormEvent) {
    e.preventDefault(); setError('');
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      router.push('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-24 p-6 bg-white rounded-xl border space-y-3">
      <h2 className="font-bold text-xl">Ingresar</h2>
      <form onSubmit={doLogin} className="space-y-2">
        <input className="w-full border rounded p-2" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full border rounded p-2" placeholder="Contraseña" type="password" value={pass} onChange={e=>setPass(e.target.value)} />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button className="w-full bg-emerald-600 text-white rounded p-2 font-bold">Entrar</button>
      </form>
    </div>
  );
}
