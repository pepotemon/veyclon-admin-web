'use client';

import * as React from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
  QueryConstraint,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import { useFiltersStore } from '@/store/useFiltersStore';
import { calcCajaFinal, canonicalTipo } from '@/lib/firestoreQueries';

type PairKey = string; // `${rutaId}||${admin}`
type Totals = {
  rutaId: string | null;
  admin: string | null;

  // acumulados del rango
  apertura: number;
  cobrado: number;
  prestado: number;
  ingresos: number;
  retiros: number;
  gastos: number;

  // derivados
  inicial: number;   // arrastre + aperturas del rango
  cajaFinal: number; // calcCajaFinal
  movimientos: number;
  score: number;
};

function keyOf(rutaId?: string | null, admin?: string | null): PairKey {
  return `${rutaId ?? ''}||${admin ?? ''}`;
}

function labelPair(rutaId?: string | null, admin?: string | null) {
  if (rutaId && admin) return `${rutaId} / ${admin}`;
  if (rutaId) return `${rutaId}`;
  if (admin) return `${admin}`;
  return '—';
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

/** Heurística simple de salud (0..100)
 *  - base por eficiencia de cobro: cobrado / (prestado + 1)
 *  - penaliza gastos y retiros en relación a cobrado
 */
function healthScore(t: Totals): number {
  const cobranza = t.cobrado / (t.prestado + 1e-6); // 0..∞
  const penalGastos = t.gastos / (t.cobrado + 1e-6);
  const penalRetiros = t.retiros / (t.cobrado + 1e-6);

  // mapear a 0..100 (suave)
  const base = Math.tanh(cobranza) * 85;              // hasta ~85 pts por buena cobranza
  const malus = (penalGastos * 30 + penalRetiros * 20); // resta
  return clamp(base - malus, 0, 100);
}

function numberFmt(n: number) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n || 0);
}

export default function RutasPage() {
  const { tenantId } = useAuthStore();
  const from = useFiltersStore((s) => s.from);
  const to = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);

  const [rows, setRows] = React.useState<Totals[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sortBy, setSortBy] = React.useState<'score'|'cobrado'|'caja'|'prestado'|'gastos'>('score');

  React.useEffect(() => {
    if (!tenantId || !from || !to) return;
    setLoading(true);
    setError(null);

    // Query principal (respeta rutaId/admin)
    const qc: QueryConstraint[] = [
      where('tenantId', '==', tenantId),
      where('operationalDate', '>=', from),
      where('operationalDate', '<=', to),
      orderBy('operationalDate', 'asc'),
    ];
    if (cobradorId) qc.push(where('admin', '==', cobradorId));
    if (rutaId) qc.push(where('rutaId', '==', rutaId));
    const qMain = query(collection(db, 'cajaDiaria'), ...qc);

    // Extra: si hay rutaId, incluimos gasto_admin aunque no tenga ruta
    let unsubExtra: Unsubscribe | null = null;
    const extras: DocumentData[] = [];
    if (rutaId) {
      const qExtra = query(
        collection(db, 'cajaDiaria'),
        where('tenantId', '==', tenantId),
        where('operationalDate', '>=', from),
        where('operationalDate', '<=', to),
        where('tipo', '==', 'gasto_admin'),
        ...(cobradorId ? [where('admin', '==', cobradorId)] : []),
        orderBy('operationalDate', 'asc'),
      );
      unsubExtra = onSnapshot(
        qExtra,
        (snap) => {
          extras.length = 0;
          snap.forEach((d) => extras.push({ ...d.data(), __docId: d.id }));
          // no emitimos solos; se emite junto con main para evitar parpadeos
        },
        (e) => console.error(e)
      );
    }

    const unsub = onSnapshot(
      qMain,
      (snap) => {
        // Combine main + extra
        const docs: DocumentData[] = [];
        snap.forEach((d) => docs.push({ ...d.data(), __docId: d.id }));
        if (extras.length) docs.push(...extras);

        // Agregar y agrupar por par {rutaId, admin}
        const map = new Map<PairKey, Totals>();
        // acumuladores diarios por par para calcular arrastre dentro del rango
        const dailyByPair: Record<PairKey, Record<string, {
          apertura: number; cobrado: number; prestado: number; ingresos: number; retiros: number; gastos: number;
        }>> = {};

        for (const d of docs) {
          const ct = canonicalTipo(String(d.tipo ?? ''));
          if (!ct) continue;
          const k = keyOf(d.rutaId ?? null, d.admin ?? null);
          const day = String(d.operationalDate);
          const monto = Number(d.monto ?? 0);

          if (!dailyByPair[k]) dailyByPair[k] = {};
          if (!dailyByPair[k][day]) {
            dailyByPair[k][day] = { apertura: 0, cobrado: 0, prestado: 0, ingresos: 0, retiros: 0, gastos: 0 };
          }
          const acc = dailyByPair[k][day];
          if (ct === 'apertura') acc.apertura += monto;
          else if (ct === 'abono') acc.cobrado += monto;
          else if (ct === 'prestamo') acc.prestado += monto;
          else if (ct === 'ingreso') acc.ingresos += monto;
          else if (ct === 'retiro') acc.retiros += monto;
          else if (ct === 'gasto') acc.gastos += monto;

          if (!map.has(k)) {
            map.set(k, {
              rutaId: d.rutaId ?? null,
              admin: d.admin ?? null,
              apertura: 0, cobrado: 0, prestado: 0, ingresos: 0, retiros: 0, gastos: 0,
              inicial: 0, cajaFinal: 0, movimientos: 0, score: 0,
            });
          }
          map.get(k)!.movimientos += 1;
        }

        // Para cada par, calculamos arrastre de inicial dentro del rango y totales
        const out: Totals[] = [];
        for (const [k, pairTotals] of map.entries()) {
          const days = Object.keys(dailyByPair[k] || {}).sort(); // asc
          let runningPrev = 0;
          let inicialAcum = 0;

          for (const day of days) {
            const a = dailyByPair[k][day];
            const inicialDay = a.apertura > 0 ? a.apertura : runningPrev;
            inicialAcum += inicialDay;

            const cierre = calcCajaFinal({
              inicial: inicialDay,
              cobrado: a.cobrado,
              ingresos: a.ingresos,
              retiros: a.retiros,
              prestado: a.prestado,
              gastos: a.gastos,
            });
            runningPrev = cierre;

            pairTotals.apertura += a.apertura;
            pairTotals.cobrado += a.cobrado;
            pairTotals.prestado += a.prestado;
            pairTotals.ingresos += a.ingresos;
            pairTotals.retiros += a.retiros;
            pairTotals.gastos += a.gastos;
          }

          const inicial = inicialAcum;
          const cajaFinal = calcCajaFinal({
            inicial,
            cobrado: pairTotals.cobrado,
            ingresos: pairTotals.ingresos,
            retiros: pairTotals.retiros,
            prestado: pairTotals.prestado,
            gastos: pairTotals.gastos,
          });

          const row: Totals = {
            ...pairTotals,
            inicial,
            cajaFinal,
            score: healthScore({
              ...pairTotals,
              inicial,
              cajaFinal,
              rutaId: map.get(k)!.rutaId,
              admin: map.get(k)!.admin,
              movimientos: map.get(k)!.movimientos,
              score: 0,
            }),
          };
          out.push(row);
        }

        // ordenar
        const sorted = [...out].sort((a, b) => {
          if (sortBy === 'score') return b.score - a.score;
          if (sortBy === 'cobrado') return b.cobrado - a.cobrado;
          if (sortBy === 'caja') return b.cajaFinal - a.cajaFinal;
          if (sortBy === 'prestado') return b.prestado - a.prestado;
          if (sortBy === 'gastos') return a.gastos - b.gastos; // menos gasto, mejor
          return 0;
        });

        setRows(sorted);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setError('No se pudo cargar el ranking de rutas.');
        setLoading(false);
      }
    );

    return () => {
      unsub();
      if (unsubExtra) unsubExtra();
    };
  }, [tenantId, from, to, rutaId, cobradorId, sortBy]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Rutas — Ranking y salud</h1>
          <p className="text-sm text-neutral-500">
            Rango: <span className="font-mono">{from}</span> → <span className="font-mono">{to}</span>
            {rutaId || cobradorId ? (
              <> · Filtro: <span className="font-mono">{rutaId ?? '—'}{rutaId && cobradorId ? ' / ' : ''}{cobradorId ?? ''}</span></>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-600">Ordenar por</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-9 rounded-xl border px-3 text-sm bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
          >
            <option value="score">Salud (score)</option>
            <option value="cobrado">Cobrado</option>
            <option value="caja">Caja final</option>
            <option value="prestado">Prestado</option>
            <option value="gastos">Gastos (asc)</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse border rounded-xl p-4 bg-white/40 dark:bg-neutral-900/40 border-neutral-200 dark:border-neutral-800">
              <div className="h-4 w-48 bg-neutral-200 dark:bg-neutral-800 rounded mb-3" />
              <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
                {Array.from({ length: 7 }).map((__, j) => (
                  <div key={j} className="h-8 bg-neutral-200 dark:bg-neutral-800 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-neutral-500">Sin actividad en el rango seleccionado.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-sm border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="px-2">Ruta / Cobrador</th>
                <th className="px-2">Score</th>
                <th className="px-2">Inicial</th>
                <th className="px-2">Cobrado</th>
                <th className="px-2">Ingresos</th>
                <th className="px-2">Retiros</th>
                <th className="px-2">Prestado</th>
                <th className="px-2">Gastos (admin)</th>
                <th className="px-2">Caja final</th>
                <th className="px-2">Movs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${r.rutaId ?? ''}-${r.admin ?? ''}-${idx}`} className="bg-white/60 dark:bg-neutral-900/60">
                  <td className="px-2 py-2 font-medium">{labelPair(r.rutaId, r.admin)}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold
                      ${r.score >= 75 ? 'bg-emerald-100 text-emerald-800' : r.score >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                      {Math.round(r.score)}
                    </span>
                  </td>
                  <td className="px-2 py-2">{numberFmt(r.inicial)}</td>
                  <td className="px-2 py-2">{numberFmt(r.cobrado)}</td>
                  <td className="px-2 py-2">{numberFmt(r.ingresos)}</td>
                  <td className="px-2 py-2">{numberFmt(r.retiros)}</td>
                  <td className="px-2 py-2">{numberFmt(r.prestado)}</td>
                  <td className="px-2 py-2">{numberFmt(r.gastos)}</td>
                  <td className="px-2 py-2 font-semibold">{numberFmt(r.cajaFinal)}</td>
                  <td className="px-2 py-2">{r.movimientos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
