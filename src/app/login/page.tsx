'use client';
import { Suspense, useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const TENANT = process.env.NEXT_PUBLIC_TENANT_ID || 'cobrox';

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') || '/';

  const [ident, setIdent] = useState(''); // usuario O email
  const [secret, setSecret] = useState(''); // pin/password
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const resolvedEmail = useMemo(() => {
    const raw = String(ident || '').trim().toLowerCase();
    if (!raw) return '';
    // Si el input contiene '@', lo usamos tal cual como email real
    if (raw.includes('@')) return raw;
    // Si no, construimos email sintético
    return `${raw}@${TENANT}.veyclon.local`;
  }, [ident]);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!resolvedEmail) throw new Error('Ingresa tu usuario o email.');
      if (!secret || secret.length < 6) throw new Error('PIN/Password inválido (mín. 6 caracteres).');

      await signInWithEmailAndPassword(auth, resolvedEmail, secret);
      router.replace(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const isEmail = ident.includes('@');

  return (
    <div className="max-w-sm mx-auto mt-24 p-6 bg-white rounded-xl border space-y-4">
      <h2 className="font-bold text-xl">Ingresar</h2>

      <form onSubmit={doLogin} className="space-y-3">
        <div>
          <input
            className="w-full border rounded p-2"
            placeholder="Usuario o Email"
            value={ident}
            onChange={(e) => setIdent(e.target.value)}
            autoComplete="username"
          />
          {!isEmail && (
            <p className="text-[11px] text-slate-500 mt-1">
              Se iniciará como: <span className="font-mono">{`*@${TENANT}.veyclon.local`}</span>
            </p>
          )}
        </div>

        <input
          className="w-full border rounded p-2"
          placeholder="PIN / Password"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="current-password"
        />

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          disabled={loading || !ident || secret.length < 6}
          className={`w-full rounded p-2 font-bold text-white ${
            loading || !ident || secret.length < 6
              ? 'bg-emerald-400/60 cursor-not-allowed'
              : 'bg-emerald-600'
          }`}
        >
          {loading ? 'Ingresando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <LoginInner />
    </Suspense>
  );
}
