'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { useFiltersStore } from '@/store/useFiltersStore';
import {
  listenCajaMovimientos,
  type MovimientoCaja,
  type CajaAggregates,
  calcCajaFinal,
} from '@/lib/firestoreQueries';

function fmtMoney(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CajaPage() {
  const { tenantId } = useAuthStore();
  const from = useFiltersStore((s) => s.from);
  const to = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);

  const [rows, setRows] = useState<MovimientoCaja[]>([]);
  const [agg, setAgg] = useState<CajaAggregates>({
    inicial: 0,
    cobrado: 0,
    prestado: 0,
    gastos: 0,
    ingresos: 0,
    retiros: 0,
    byDate: {},
    byTipo: {},
  });
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!tenantId || !from || !to) return;
    setError('');
    const unsub = listenCajaMovimientos(
      { tenantId, from, to, rutaId, cobradorId },
      (r, a) => {
        setRows(r);
        setAgg(a);
      },
      (e) => setError((e as { message?: string })?.message || String(e))
    );
    return () => unsub();
  }, [tenantId, from, to, rutaId, cobradorId]);

  const cajaFinal = useMemo(() => calcCajaFinal(agg), [agg]);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Caja</h2>
        {from === to && (
          <Link
            href={`/cierres?date=${encodeURIComponent(from)}`}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold"
          >
            Ver cierre {from}
          </Link>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Inicial" value={agg.inicial} />
        <Kpi label="Cobrado" value={agg.cobrado} />
        <Kpi label="Prestado" value={agg.prestado} />
        <Kpi label="Ingresos" value={agg.ingresos} />
        <Kpi label="Gastos" value={agg.gastos} />
        <Kpi label="Caja Final" value={cajaFinal} highlight />
      </div>

      {/* Fórmula */}
      <div className="text-xs text-slate-600">
        <span className="font-semibold">Fórmula:</span>{' '}
        cajaFinal = inicial + cobrado + ingresos - retiros - prestado - gastos
      </div>

      {/* Tabla de movimientos */}
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="min-w-[800px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <Th>Fecha</Th>
              <Th>Tipo</Th>
              <Th>Monto</Th>
              <Th>Cobrador</Th>
              <Th>Ruta</Th>
              <Th>Cliente</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">
                  Sin movimientos en el rango seleccionado.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <Td>{r.operationalDate}</Td>
                <Td className="capitalize">{r.tipo}</Td>
                <Td mono>{fmtMoney(r.monto)}</Td>
                <Td>{r.admin ?? '—'}</Td>
                <Td>{r.rutaId ?? '—'}</Td>
                <Td>{r.clienteNombre ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${highlight ? 'border-emerald-300' : ''}`}>
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="text-2xl font-black">
        {value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="p-3 text-xs font-semibold text-slate-600">{children}</th>;
}

function Td({
  children,
  mono,
  className,
}: {
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td className={`p-3 ${mono ? 'font-mono text-[12px]' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}
