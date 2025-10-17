'use client';
import { useEffect } from 'react';
import { initAuthListener } from '@/store/useAuthStore';

export default function Providers({ children }: { children: React.ReactNode }) {
  // Arranca el listener de Firebase Auth solo en el cliente
  useEffect(() => { initAuthListener(); }, []);
  return <>{children}</>;
}
