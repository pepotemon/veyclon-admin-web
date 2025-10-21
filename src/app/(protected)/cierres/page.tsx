'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useFiltersStore } from '@/store/useFiltersStore';
import {
  listenCierresAggregates,
  type DailySummary,
  calcCajaFinal,
} from '@/lib/firestoreQueries';

function fmtMoney(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CierresPage() {
  const search = useSearchParams();
  const dateParam = search.get('date') || undefined;

  const { tenantId } = useAuthStore();
  const from = useFiltersStore((s) => s.from);
  const to   = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);

  const [days, setDays] = React.useState<DailySummary[]>([]);
  const [error, setError] = React.useState<string>('');

  React.useEffect(() => {
    if (!tenantId || !from || !to) return;

    setError('');
    const unsub = listenCierresAggregates(
      {
        tenantId,
        from: dateParam ?? from,
        to:   dateParam ?? to,
        rutaId,
        cobradorId,
      },
      (d) => setDays(d),
      (e: unknown) => {
        // Manejo seguro del error (evita 'Property message does not exist on type {}')
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    );

    return () => unsub();
  }, [tenantId, from, to, rutaId, cobradorId, dateParam]);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Cierres</h2>
        {dateParam ? (
          <Link
            href="/caja"
            className="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-bold"
          >
            Volver a Caja
          </Link>
        ) : null}
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3">
          {error}
        </div>
      ) : null}

      {days.length === 0 ? (
        <div className="rounded-lg border bg-white p-4 text-slate-600">
          No hay cierres en el rango seleccionado.
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <section key={d.date} className="rounded-xl border bg-white">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="font-bold">{d.date}</div>
                <div className="text-sm text-slate-500">
                  Caja final (total): <span className="font-semibold">{fmtMoney(d.totals.cajaFinal)}</span>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="min-w-[720px] w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left">
                      <Th>Admin</Th>
                      <Th>Inicial</Th>
                      <Th>Cobrado</Th>
                      <Th>Prestado</Th>
                      <Th>Ingresos</Th>
                      <Th>Gastos</Th>
                      <Th>Retiros</Th>
                      <Th>Caja Final</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.admins.map((a) => (
                      <tr key={a.adminId} className="border-t">
                        <Td>{a.adminId}</Td>
                        <Td mono>{fmtMoney(a.inicial)}</Td>
                        <Td mono>{fmtMoney(a.cobrado)}</Td>
                        <Td mono>{fmtMoney(a.prestado)}</Td>
                        <Td mono>{fmtMoney(a.ingresos)}</Td>
                        <Td mono>{fmtMoney(a.gastos)}</Td>
                        <Td mono>{fmtMoney(a.retiros)}</Td>
                        <Td mono className="font-semibold">{fmtMoney(a.cajaFinal)}</Td>
                      </tr>
                    ))}

                    {/* Totales del día */}
                    <tr className="border-t bg-slate-50 font-semibold">
                      <Td>Total</Td>
                      <Td mono>{fmtMoney(d.totals.inicial)}</Td>
                      <Td mono>{fmtMoney(d.totals.cobrado)}</Td>
                      <Td mono>{fmtMoney(d.totals.prestado)}</Td>
                      <Td mono>{fmtMoney(d.totals.ingresos)}</Td>
                      <Td mono>{fmtMoney(d.totals.gastos)}</Td>
                      <Td mono>{fmtMoney(d.totals.retiros)}</Td>
                      <Td mono>{fmtMoney(d.totals.cajaFinal)}</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
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
