'use client';
import { useAuthStore } from '@/store/useAuthStore';
import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import GlobalFilters from '@/components/filters/GlobalFilters';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
  }, [user, loading, router, pathname]);

  const showFilters = useMemo(() => {
    if (!pathname) return false;
    // Ocultar donde no aplica
    const HIDE = ['/usuarios', '/login'];
    return !HIDE.some((p) => pathname.startsWith(p));
  }, [pathname]);

  if (loading) return <div className="p-6">Cargando…</div>;
  if (!user) return null;

  return (
    <>
      {showFilters && <GlobalFilters />}
      {children}
    </>
  );
}
