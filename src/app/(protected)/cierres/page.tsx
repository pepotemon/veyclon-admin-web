'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useFiltersStore } from '@/store/useFiltersStore';
import {
  listenCierresAggregates,
  type DailySummary,
} from '@/lib/firestoreQueries';

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CierresPage() {
  const { tenantId } = useAuthStore();
  const from = useFiltersStore((s) => s.from);
  const to = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);
  const sp = useSearchParams();
  const dateParam = sp.get('date'); // si viene desde Caja → ?date=YYYY-MM-DD

  const [days, setDays] = React.useState<DailySummary[]>([]);
  const [error, setError] = React.useState<string>('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!tenantId || !from || !to) return;
    setError('');
    const unsub = listenCierresAggregates(
      { tenantId, from, to, rutaId, cobradorId },
      (items) => {
        setDays(items);
        // Si viene dateParam, expandimos ese día por defecto
        if (dateParam) {
          setExpanded((prev) => ({ ...prev, [dateParam]: true }));
        }
      },
      (e) => setError(e?.message || String(e))
    );
    return () => unsub();
  }, [tenantId, from, to, rutaId, cobradorId, dateParam]);

  const list = React.useMemo(() => {
    if (!dateParam) return days;
    return days.filter((d) => d.date === dateParam);
  }, [days, dateParam]);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Cierres</h2>
        <div className="text-xs text-slate-600">
          Rango: <span className="font-mono">{from}</span> → <span className="font-mono">{to}</span>
          {rutaId && <> · Ruta: <span className="font-mono">{rutaId}</span></>}
          {cobradorId && <> · Cobrador: <span className="font-mono">{cobradorId}</span></>}
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3">
          {error}
        </div>
      )}

      {list.length === 0 && (
        <div className="rounded-lg border bg-white p-4 text-slate-500">
          No hay cierres en el rango seleccionado.
        </div>
      )}

      <div className="space-y-4">
        {list.map((d) => {
          const isOpen = !!expanded[d.date];
          return (
            <section key={d.date} className="rounded-xl border bg-white">
              <button
                onClick={() => setExpanded((s) => ({ ...s, [d.date]: !s[d.date] }))}
                className="w-full flex items-center justify-between p-4"
              >
                <div className="flex flex-col items-start">
                  <div className="text-sm text-slate-500">{d.date}</div>
                  <div className="text-[13px] text-slate-500">
                    Caja Final Total:{' '}
                    <b className="text-slate-800">{fmt(d.totals.cajaFinal)}</b>
                    {' · '}Cobrado: <b>{fmt(d.totals.cobrado)}</b>
                    {' · '}Prestado: <b>{fmt(d.totals.prestado)}</b>
                    {' · '}Gastos: <b>{fmt(d.totals.gastos)}</b>
                  </div>
                </div>
                <span className="text-xs font-semibold text-emerald-700">
                  {isOpen ? 'Ocultar' : 'Ver detalle'}
                </span>
              </button>

              {isOpen && (
                <div className="border-t">
                  <div className="overflow-auto">
                    <table className="min-w-[900px] w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left">
                          <Th>Cobrador</Th>
                          <Th>Inicial</Th>
                          <Th>Cobrado</Th>
                          <Th>Prestado</Th>
                          <Th>Ingresos</Th>
                          <Th>Retiros</Th>
                          <Th>Gastos</Th>
                          <Th>Caja Final</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.admins.length === 0 && (
                          <tr>
                            <td colSpan={8} className="p-4 text-center text-slate-500">
                              Sin datos de cobradores.
                            </td>
                          </tr>
                        )}
                        {d.admins.map((a) => (
                          <tr key={a.adminId} className="border-t">
                            <Td>{a.adminId}</Td>
                            <Td mono>{fmt(a.inicial)}</Td>
                            <Td mono>{fmt(a.cobrado)}</Td>
                            <Td mono>{fmt(a.prestado)}</Td>
                            <Td mono>{fmt(a.ingresos)}</Td>
                            <Td mono>{fmt(a.retiros)}</Td>
                            <Td mono>{fmt(a.gastos)}</Td>
                            <Td mono className="font-semibold">{fmt(a.cajaFinal)}</Td>
                          </tr>
                        ))}
                        {/* Totales fila */}
                        <tr className="border-t bg-slate-50/70">
                          <Td className="font-semibold">TOTAL</Td>
                          <Td mono className="font-semibold">{fmt(d.totals.inicial)}</Td>
                          <Td mono className="font-semibold">{fmt(d.totals.cobrado)}</Td>
                          <Td mono className="font-semibold">{fmt(d.totals.prestado)}</Td>
                          <Td mono className="font-semibold">{fmt(d.totals.ingresos)}</Td>
                          <Td mono className="font-semibold">{fmt(d.totals.retiros)}</Td>
                          <Td mono className="font-semibold">{fmt(d.totals.gastos)}</Td>
                          <Td mono className="font-semibold">{fmt(d.totals.cajaFinal)}</Td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Nota / fórmula */}
                  <div className="p-3 text-[12px] text-slate-500">
                    Fórmula: cajaFinal = inicial + cobrado + ingresos - retiros - prestado - gastos
                  </div>
                </div>
              )}
            </section>
          );
        })}
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
