'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
  QueryConstraint,
} from 'firebase/firestore';
import { useFiltersStore } from '@/store/useFiltersStore';
import { useAuthStore } from '@/store/useAuthStore';
import { resolveTenantTZ, todayInTZ } from '@/lib/tz';

type Pair = { rutaId: string | null; admin: string; source?: string | null };
type Option = {
  id: string;
  rutaId: string | null;
  admin: string;
  label: string; // "rutaId / admin" o "DEMO / admin"
};

// Escribe los query params sin perder otros existentes
function writeParams(router: ReturnType<typeof useRouter>, params: URLSearchParams) {
  const qs = params.toString();
  router.replace(qs ? `?${qs}` : '?');
}

export default function GlobalFilters() {
  const router = useRouter();
  const search = useSearchParams();

  // Filtros globales
  const from = useFiltersStore((s) => s.from);
  const to = useFiltersStore((s) => s.to);
  const rutaId = useFiltersStore((s) => s.rutaId);
  const cobradorId = useFiltersStore((s) => s.cobradorId);
  const setFrom = useFiltersStore((s) => s.setFrom);
  const setTo = useFiltersStore((s) => s.setTo);
  const setRutaId = useFiltersStore((s) => s.setRutaId);
  const setCobradorId = useFiltersStore((s) => s.setCobradorId);
  const setMany = useFiltersStore((s) => s.setMany);

  // Tenant actual (para query)
  const { tenantId } = useAuthStore();

  const [hydrated, setHydrated] = React.useState(false);
  const [tz, setTz] = React.useState('America/Sao_Paulo');

  // Opciones
  const [loadingOpts, setLoadingOpts] = React.useState(true);
  const [options, setOptions] = React.useState<Option[]>([]);

  // Combobox (unifica selector + búsqueda)
  const [open, setOpen] = React.useState(false);
  const [queryText, setQueryText] = React.useState('');
  const anchorRef = React.useRef<HTMLDivElement | null>(null);

  // 1) Resolver TZ del tenant (mock)
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const t = await resolveTenantTZ();
      if (!alive) return;
      setTz(t);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 2) Hidratar desde URL o defaults según TZ (solo una vez)
  React.useEffect(() => {
    if (hydrated) return;

    const qs = new URLSearchParams(search.toString());
    const urlFrom = qs.get('from');
    const urlTo = qs.get('to');
    const urlRuta = qs.get('rutaId');
    const urlCobr = qs.get('cobradorId');

    const def = todayInTZ(tz);
    const merged = {
      from: urlFrom || from || def,
      to: urlTo || to || def,
      rutaId: (urlRuta || rutaId || '') || null,
      cobradorId: (urlCobr || cobradorId || '') || null,
    };

    setMany(merged);

    // Normalizamos URL
    if (merged.from) qs.set('from', merged.from);
    if (merged.to) qs.set('to', merged.to);
    merged.rutaId ? qs.set('rutaId', merged.rutaId) : qs.delete('rutaId');
    merged.cobradorId ? qs.set('cobradorId', merged.cobradorId) : qs.delete('cobradorId');

    writeParams(router, qs);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tz]);

  // 3) Cargar/escuchar pares desde cajaDiaria y **unificar DEMO+RUTA por admin**
  React.useEffect(() => {
    if (!tenantId || !from || !to) return;

    setLoadingOpts(true);
    const qc: QueryConstraint[] = [
      where('tenantId', '==', tenantId),
      where('operationalDate', '>=', from),
      where('operationalDate', '<=', to),
      orderBy('operationalDate', 'asc'),
    ];
    const qCaja = query(collection(db, 'cajaDiaria'), ...qc);

    const unsub = onSnapshot(
      qCaja,
      async (snap) => {
        // Mapa por ADMIN: priorizamos ruta real si existe; si no, quedamos con DEMO (rutaId=null)
        const byAdmin = new Map<string, Pair>(); // key: admin -> Pair {rutaId|null, admin}
        snap.forEach((doc) => {
          const d = doc.data() as DocumentData;
          const admin = String(d.admin ?? '').trim();
          if (!admin) return;

          // ruta puede ser nula/vacía (demo)
          const ruta: string | null =
            d.rutaId === null || d.rutaId === undefined || String(d.rutaId).trim() === ''
              ? null
              : String(d.rutaId).trim();
          const source = (d.source ? String(d.source) : null) as string | null;

          const existing = byAdmin.get(admin);
          if (!existing) {
            byAdmin.set(admin, { rutaId: ruta, admin, source });
          } else {
            // Si ya hay DEMO (null) y llega una ruta real -> reemplazamos.
            if (existing.rutaId === null && ruta) {
              byAdmin.set(admin, { rutaId: ruta, admin, source });
            }
          }
        });

        // Fallback opcional desde usuarios si no hay nada en el rango
        try {
          if (byAdmin.size === 0) {
            const usersSnap = await getDocs(
              query(collection(db, 'usuarios'), where('role', '==', 'cobrador'))
            );
            usersSnap.forEach((d) => {
              const data = d.data() as DocumentData;
              const admin = String(data.displayName || data.nombre || data.email || d.id).trim();
              const ruta = String(data.rutaId || '').trim();
              if (!admin) return;
              if (byAdmin.has(admin)) return;
              if (!ruta) return;
              byAdmin.set(admin, { rutaId: ruta, admin, source: null });
            });
          }
        } catch {
          /* noop */
        }

        // Construir opciones (una por admin)
        const opts: Option[] = Array.from(byAdmin.values()).map((p) => ({
          id: (p.rutaId ? `${p.rutaId}` : '__demo__') + '||' + p.admin,
          rutaId: p.rutaId ?? null,
          admin: p.admin,
          label: buildPairLabel(p), // "rutaId / admin" o "DEMO / admin"
        }));

        // Ordenar por label
        opts.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
        setOptions(opts);
        setLoadingOpts(false);
      },
      () => setLoadingOpts(false)
    );

    return () => unsub();
  }, [tenantId, from, to]);

  // 4) Propagar cambios a URL (debounce)
  const writeUrlDebounced = React.useRef(
    debounce(
      (payload: { from?: string; to?: string; rutaId?: string | null; cobradorId?: string | null }) => {
        const qs = new URLSearchParams(window.location.search);
        if (payload.from) qs.set('from', payload.from);
        if (payload.to) qs.set('to', payload.to);
        if (payload.rutaId !== undefined) {
          payload.rutaId ? qs.set('rutaId', payload.rutaId) : qs.delete('rutaId');
        }
        if (payload.cobradorId !== undefined) {
          payload.cobradorId ? qs.set('cobradorId', payload.cobradorId) : qs.delete('cobradorId');
        }
        writeParams(router, qs);
      },
      200
    )
  );

  const onChangeFrom = (v: string) => {
    setFrom(v);
    writeUrlDebounced.current({ from: v });
  };

  const onChangeTo = (v: string) => {
    setTo(v);
    writeUrlDebounced.current({ to: v });
  };

  // ✅ Aplicar selección combinada (rutaId + cobradorId)
  const applySelection = (opt: Option | null) => {
    const nextRuta = opt?.rutaId ?? null; // si es demo -> null; si es ruta -> la ruta
    const nextAdmin = opt?.admin ?? null;
    setRutaId(nextRuta);
    setCobradorId(nextAdmin);
    writeUrlDebounced.current({ rutaId: nextRuta, cobradorId: nextAdmin });
  };

  // Combobox: filtrar opciones localmente
  const filtered = React.useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, queryText]);

  // Texto del input
  const currentLabel = React.useMemo(() => {
    // 1) match exacto rutaId+admin
    let match = options.find(
      (o) =>
        (o.rutaId ?? null) === (rutaId ?? null) &&
        (o.admin || '') === (cobradorId || '')
    );
    // 2) fallback por admin (si cambió de DEMO→ruta y store aún tiene null)
    if (!match && cobradorId) {
      match = options.find((o) => o.admin === cobradorId);
    }
    return match?.label ?? '';
  }, [options, rutaId, cobradorId]);

  // Cerrar al click fuera
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!anchorRef.current) return;
      if (!anchorRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="w-full border-b border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/70 backdrop-blur supports-[backdrop-filter]:bg-white/50 sticky top-0 z-30">
      <div className="mx-auto max-w-7xl px-4 py-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        {/* Date range */}
        <div className="flex items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs text-neutral-500">Desde</label>
            <input
              type="date"
              value={from || ''}
              onChange={(e) => onChangeFrom(e.target.value)}
              className="h-9 rounded-xl border px-3 text-sm bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-neutral-500">Hasta</label>
            <input
              type="date"
              value={to || ''}
              onChange={(e) => onChangeTo(e.target.value)}
              className="h-9 rounded-xl border px-3 text-sm bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
            />
          </div>
        </div>

        {/* Combobox: Selector + Buscar en un solo input */}
        <div className="flex items-end gap-3">
          <div className="flex flex-col min-w-[340px]" ref={anchorRef}>
            <label className="text-xs text-neutral-500">Ruta / Cobrador</label>
            <div className="relative">
              <input
                placeholder={loadingOpts ? 'Cargando…' : 'Selecciona o busca (p. ej. 32323 / Pedro)'}
                value={open ? queryText : currentLabel}
                onChange={(e) => {
                  setQueryText(e.target.value);
                  if (!open) setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                className="h-9 w-full rounded-xl border px-3 text-sm bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
              />

              {/* Limpiar selección */}
              {(rutaId !== null || cobradorId) && !open ? (
                <button
                  type="button"
                  onClick={() => applySelection(null)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500 hover:text-neutral-800"
                  title="Limpiar selección"
                >
                  ✕
                </button>
              ) : null}

              {open ? (
                <div className="absolute left-0 right-0 mt-1 max-h-64 overflow-auto rounded-xl border bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 shadow-lg z-10">
                  {/* Opción Todos */}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    onClick={() => {
                      applySelection(null);
                      setQueryText('');
                      setOpen(false);
                    }}
                  >
                    Todos
                  </button>

                  {filtered.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-neutral-500">Sin resultados</div>
                  ) : null}

                  {filtered.map((o) => {
                    const selected =
                      (o.rutaId ?? null) === (rutaId ?? null) &&
                      (o.admin || '') === (cobradorId || '');
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 ${
                          selected ? 'bg-neutral-50 dark:bg-neutral-800 font-semibold' : ''
                        }`}
                        onClick={() => {
                          applySelection(o);
                          setQueryText('');
                          setOpen(false);
                        }}
                      >
                        <span>{o.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- helpers ---
function buildPairLabel(p: Pair) {
  if (!p.rutaId) return `DEMO / ${p.admin}`;
  return `${p.rutaId} / ${p.admin}`;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms = 200) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
