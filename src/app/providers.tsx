'use client';
import { useEffect } from 'react';
import { initAuthListener } from '@/store/useAuthStore';

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => { initAuthListener(); }, []);
  return <>{children}</>;
}
