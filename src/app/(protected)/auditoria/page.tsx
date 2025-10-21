'use client';

import * as React from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useFiltersStore } from '@/store/useFiltersStore';
import { listenAuditLogs, type AuditRow, type AuditType } from '@/lib/audit';

function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-sm border transition
        ${active
          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-neutral-900 dark:border-white'
          : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
        }`}
    >
      {children}
    </button>
  );
}

function moneyBRL(n?: number | null) {
  return typeof n === 'number'
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '—';
}

export default function AuditoriaPage() {
  const { tenantId } = useAuthStore();
  const from = useFiltersStore((s) => s.from);
  const to = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);

  const [typeFilter, setTypeFilter] = React.useState<'all' | AuditType>('all');
  const [rows, setRows] = React.useState<AuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Paginación
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageItems = rows.slice((page - 1) * pageSize, page * pageSize);

  React.useEffect(() => setPage(1), [typeFilter, from, to, rutaId, cobradorId]);

  React.useEffect(() => {
    if (!tenantId || !from || !to) return;
    setLoading(true);
    setError(null);

    const unsub = listenAuditLogs(
      { tenantId, from, to, rutaId, cobradorId, typeFilter },
      (list) => {
        setRows(list);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setError('No se pudo cargar la auditoría.');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [tenantId, from, to, rutaId, cobradorId, typeFilter]);

  const chips: Array<{ k: 'all' | AuditType; label: string }> = [
    { k: 'all', label: 'Todos' },
    { k: 'cobro', label: 'Cobros' },
    { k: 'prestamo', label: 'Préstamos' },
    { k: 'gasto_admin', label: 'Gastos admin' },
    { k: 'gasto_cobrador', label: 'Gastos cobrador' },
    { k: 'ingreso', label: 'Ingresos' },
    { k: 'retiro', label: 'Retiros' },
    { k: 'apertura', label: 'Aperturas' },
    { k: 'usuario', label: 'Usuarios' },
    { k: 'config', label: 'Configuración' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Auditoría</h1>
        <p className="text-sm text-neutral-500">
          Rango: <span className="font-mono">{from}</span> → <span className="font-mono">{to}</span>
          {rutaId || cobradorId ? (
            <> · Filtro: <span className="font-mono">{rutaId ?? '—'}{rutaId && cobradorId ? ' / ' : ''}{cobradorId ?? ''}</span></>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {chips.map((c) => (
          <Chip key={c.k} active={typeFilter === c.k} onClick={() => setTypeFilter(c.k)}>
            {c.label}
          </Chip>
        ))}
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
              <div className="h-4 w-60 bg-neutral-200 dark:bg-neutral-800 rounded mb-3" />
              <div className="h-6 w-full bg-neutral-200 dark:bg-neutral-800 rounded" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-neutral-500">Sin eventos de auditoría en el rango/selector.</div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800/60">
              <tr className="text-left">
                <Th>Fecha</Th>
                <Th>Hora</Th>
                <Th>Tipo</Th>
                <Th>Detalle</Th>
                <Th>Monto</Th>
                <Th>Cobrador</Th>
                <Th>Ruta</Th>
                <Th>Cliente</Th>
                <Th>Préstamo</Th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => {
                const dt = new Date(r.ts);
                const hh = String(dt.getHours()).padStart(2, '0');
                const mm = String(dt.getMinutes()).padStart(2, '0');

                return (
                  <tr key={r.id} className="border-t">
                    <Td>{r.date}</Td>
                    <Td>{`${hh}:${mm}`}</Td>
                    <Td className="capitalize">{r.type.replace('_', ' ')}</Td>
                    {/* Detalle: según reglas (puede quedar vacío para cobro/prestamo/apertura sin nota) */}
                    <Td>{r.label || '—'}</Td>
                    <Td mono>{moneyBRL(r.amount)}</Td>
                    <Td>{r.admin ?? '—'}</Td>
                    <Td>{r.rutaId ?? '—'}</Td>
                    {/* Cliente: nombre completo si existe */}
                    <Td>{r.clienteNombre ?? '—'}</Td>
                    {/* Préstamo: solo valor, sin ID */}
                    <Td mono>{moneyBRL(r.prestamoValor)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {!loading && rows.length > pageSize && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} de {rows.length}
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="p-3 text-xs font-semibold text-neutral-600 dark:text-neutral-300">{children}</th>;
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
    <td className={`p-3 align-middle ${mono ? 'font-mono text-[12px]' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}
