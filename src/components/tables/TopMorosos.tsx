'use client';
import * as React from 'react';
import type { MorosoItem } from '@/lib/useMorosidad';

function money(n: number) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);
}

export default function TopMorosos({ rows }: { rows: MorosoItem[] }) {
  if (!rows?.length) {
    return <div className="text-sm text-neutral-500">Sin morosos en el rango/selector.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[720px] w-full text-sm border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="px-2">Cliente</th>
            <th className="px-2">Préstamo</th>
            <th className="px-2">Restante</th>
            <th className="px-2">Días atraso</th>
            <th className="px-2">Ruta</th>
            <th className="px-2">Cobrador</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.prestamoId} className="bg-white/60 dark:bg-neutral-900/60">
              <td className="px-2 py-2">{r.nombre ?? r.clienteId ?? '—'}</td>
              <td className="px-2 py-2 font-mono text-[12px]">{r.prestamoId}</td>
              <td className="px-2 py-2 font-semibold">{money(r.restante)}</td>
              <td className="px-2 py-2">{r.diasAtraso ?? 0}</td>
              <td className="px-2 py-2 font-mono">{r.rutaId ?? '—'}</td>
              <td className="px-2 py-2">{r.admin ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
