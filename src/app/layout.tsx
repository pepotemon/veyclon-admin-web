import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Veyclon Clientes Admin',
  description: 'Panel administrativo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <div className="flex min-h-screen">
          <aside className="w-60 border-r bg-white p-4 space-y-2">
            <h1 className="font-black text-lg">Veyclon Clientes Admin</h1>
            <nav className="flex flex-col gap-2 text-sm">
              <Link href="/">Dashboard</Link>
              <Link href="/caja">Caja</Link>
              <Link href="/cierres">Cierres</Link>
              <Link href="/rutas">Rutas</Link>
              <Link href="/clientes">Clientes</Link>
              <Link href="/alertas">Alertas</Link>
              <Link href="/auditoria">Auditoría</Link>
              <Link href="/usuarios">Usuarios</Link>
            </nav>
          </aside>

          {/* Todo lo que necesite hooks/client va envuelto en Providers */}
          <main className="flex-1 p-6">
            <Providers>{children}</Providers>
          </main>
        </div>
      </body>
    </html>
  );
}
