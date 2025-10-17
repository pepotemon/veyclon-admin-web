'use client';
import { useAuthStore } from '@/store/useAuthStore';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
  }, [user, loading, router, pathname]);

  if (loading) return <div className="p-6">Cargando…</div>;
  if (!user) return null; // redirigiendo

  return <>{children}</>;
}
