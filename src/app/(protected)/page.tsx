'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useFiltersStore } from '@/store/useFiltersStore';
import { KpiCard } from '@/components/KpiCard';
import { TimeSeries, StackedBars, Donut } from '@/components/Charts';
import {
  listenCajaMovimientos,
  type CajaAggregates,
  calcCajaFinal,
} from '@/lib/firestoreQueries';
import { useMorosidad } from '@/lib/useMorosidad';

function toSeriesFromByDate(byDate: Record<string, number>) {
  return Object.entries(byDate).map(([x, y]) => ({ x, y }));
}

export default function Dashboard() {
  const { tenantId } = useAuthStore();
  const from = useFiltersStore((s) => s.from);
  const to = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);

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
      (_rows, a) => setAgg(a),
      (e) => setError(e?.message || String(e))
    );
    return () => unsub();
  }, [tenantId, from, to, rutaId, cobradorId]);

  const cajaFinal = useMemo(() => calcCajaFinal(agg), [agg]);

  // Series para gráficos
  const serieCobrado = useMemo(() => toSeriesFromByDate(agg.byDate), [agg.byDate]);

  const seriesStacked = useMemo(
    () => [
      { key: 'prestado', data: [{ x: 'total', y: agg.prestado }] },
      { key: 'cobrado', data: [{ x: 'total', y: agg.cobrado }] },
      { key: 'gastos', data: [{ x: 'total', y: agg.gastos }] },
    ],
    [agg.prestado, agg.cobrado, agg.gastos]
  );

  // -------- Morosidad (real) --------
  const { activos, enAtraso, top, loading: loadingMorosidad, error: errorMorosidad } = useMorosidad({
    tenantId,
    rutaId,
    cobradorId,
    limitTop: 5,
  });

  const donutMorosidad = useMemo(() => {
    if (activos <= 0) {
      return [
        { name: 'Sin datos', value: 1 },
      ];
    }
    const alDia = Math.max(activos - enAtraso, 0);
    const total = activos; // usamos proporciones (tu <Donut /> espera valores que sumen aprox 1)
    return [
      { name: 'Al día', value: alDia / total },
      { name: 'En atraso', value: enAtraso / total },
    ];
  }, [activos, enAtraso]);

  return (
    <div className="space-y-4">
      {(error || errorMorosidad) && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3">
          {error || errorMorosidad}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiCard title="Inicial" value={agg.inicial} formatCurrency />
        <KpiCard title="Cobrado" value={agg.cobrado} formatCurrency />
        <KpiCard title="Prestado" value={agg.prestado} formatCurrency />
        <KpiCard title="Ingresos" value={agg.ingresos} formatCurrency />
        <KpiCard title="Gastos" value={agg.gastos} formatCurrency />
        <KpiCard title="Caja Final" value={cajaFinal} formatCurrency />
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-3">
          <h3 className="font-bold mb-2">Cobrado por día</h3>
          <TimeSeries data={serieCobrado} />
        </div>

        <div className="bg-white rounded-xl border p-3">
          <h3 className="font-bold mb-2">Préstamos vs Cobros vs Gastos</h3>
          <StackedBars series={seriesStacked} />
        </div>

        <div className="bg-white rounded-xl border p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold">Morosidad</h3>
            <div className="text-xs text-neutral-500">
              {rutaId || cobradorId ? (
                <span>
                  Filtro: <span className="font-mono">{rutaId ?? '—'}{rutaId && cobradorId ? ' / ' : ''}{cobradorId ?? ''}</span>
                </span>
              ) : (
                <span>Todos</span>
              )}
            </div>
          </div>

          {/* Donut */}
          <div className="mb-3">
            {loadingMorosidad ? (
              <div className="h-40 animate-pulse rounded-xl bg-neutral-100" />
            ) : (
              <Donut data={donutMorosidad} />
            )}
          </div>

          {/* Top 5 morosos (simple) */}
          <div>
            <h4 className="text-sm font-semibold mb-1">Top morosos</h4>
            {loadingMorosidad ? (
              <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />
            ) : top.length === 0 ? (
              <div className="text-sm text-neutral-500">Sin morosos en el rango/selector.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[680px] w-full text-sm border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="px-2 py-1">Cliente</th>
                      <th className="px-2 py-1">Préstamo</th>
                      <th className="px-2 py-1">Restante</th>
                      <th className="px-2 py-1">Días atraso</th>
                      <th className="px-2 py-1">Ruta</th>
                      <th className="px-2 py-1">Cobrador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={r.prestamoId} className="bg-neutral-50">
                        <td className="px-2 py-1">{r.nombre ?? r.clienteId ?? '—'}</td>
                        <td className="px-2 py-1 font-mono text-[12px]">{r.prestamoId}</td>
                        <td className="px-2 py-1 font-semibold">
                          {new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(r.restante || 0)}
                        </td>
                        <td className="px-2 py-1">{r.diasAtraso ?? 0}</td>
                        <td className="px-2 py-1 font-mono">{r.rutaId ?? '—'}</td>
                        <td className="px-2 py-1">{r.admin ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
