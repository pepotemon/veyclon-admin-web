'use client';

import * as React from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useFiltersStore } from '@/store/useFiltersStore';
import { useAlerts, type AlertItem } from '@/lib/alerts';

function Badge({ children, tone }: { children: React.ReactNode; tone: 'green' | 'amber' | 'red' | 'gray' }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-800',
    gray: 'bg-neutral-100 text-neutral-800',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function kindLabel(kind: AlertItem['kind']) {
  if (kind === 'cierre_faltante') return 'Cierre faltante';
  if (kind === 'promesa_vencida') return 'Promesa vencida';
  return kind;
}

function sevTone(sev: AlertItem['severity']): 'green' | 'amber' | 'red' | 'gray' {
  if (sev === 'high') return 'red';
  if (sev === 'medium') return 'amber';
  if (sev === 'low') return 'green';
  return 'gray';
}

export default function AlertasPage() {
  const { tenantId } = useAuthStore();
  const from = useFiltersStore((s) => s.from);
  const to = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);

  const { list, loading, error } = useAlerts({
    tenantId: tenantId!,
    from: from!,
    to: to!,
    rutaId,
    cobradorId,
  });

  // Paginación cliente
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const pageItems = list.slice((page - 1) * pageSize, page * pageSize);

  React.useEffect(() => { setPage(1); }, [from, to, rutaId, cobradorId]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Alertas</h1>
        <p className="text-sm text-neutral-500">
          Rango: <span className="font-mono">{from}</span> → <span className="font-mono">{to}</span>
          {rutaId || cobradorId ? (
            <> · Filtro: <span className="font-mono">{rutaId ?? '—'}{rutaId && cobradorId ? ' / ' : ''}{cobradorId ?? ''}</span></>
          ) : null}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse border rounded-xl p-4 bg-white/40 dark:bg-neutral-900/40 border-neutral-200 dark:border-neutral-800">
              <div className="h-4 w-48 bg-neutral-200 dark:bg-neutral-800 rounded mb-3" />
              <div className="h-6 w-full bg-neutral-200 dark:bg-neutral-800 rounded" />
            </div>
          ))}
        </div>
      ) : pageItems.length === 0 ? (
        <div className="text-neutral-500">Sin alertas en el rango seleccionado.</div>
      ) : (
        <div className="space-y-2">
          {pageItems.map((a) => (
            <div key={a.id} className="border rounded-2xl p-4 bg-white/60 dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone={sevTone(a.severity)}>{kindLabel(a.kind)}</Badge>
                  <span className="text-sm text-neutral-600">
                    {a.adminId ? <span className="font-mono">{a.adminId}</span> : null}
                    {a.adminId && a.rutaId ? ' · ' : ''}
                    {a.rutaId ? <span className="font-mono">ruta {a.rutaId}</span> : null}
                  </span>
                </div>
                <span className="text-xs text-neutral-500 font-mono">{a.date}</span>
              </div>
              <div className="text-sm mt-2">{a.message}</div>
              {a.kind === 'promesa_vencida' && a.meta?.restante != null && (
                <div className="text-xs text-neutral-500 mt-1">
                  Restante: <b>{new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(a.meta.restante)}</b>
                  {a.meta?.diasAtraso ? <> · Días atraso: <b>{a.meta.diasAtraso}</b></> : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      {!loading && list.length > pageSize && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, list.length)} de {list.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Anterior
            </button>
            <span className="text-sm">{page} / {totalPages}</span>
            <button
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
