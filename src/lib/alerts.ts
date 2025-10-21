'use client';

import * as React from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
  QueryConstraint,
  Unsubscribe,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { canonicalTipo } from '@/lib/firestoreQueries';
import { todayInTZ, resolveTenantTZ } from '@/lib/tz';

export type AlertKind = 'cierre_faltante' | 'promesa_vencida';
export type AlertSeverity = 'low' | 'medium' | 'high';

export type AlertItem = {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  date: string;          // YYYY-MM-DD (día operativo o fecha promesa)
  message: string;
  adminId?: string | null;
  rutaId?: string | null;
  meta?: Record<string, any>;
};

type AlertsOpts = {
  tenantId: string;
  from: string;
  to: string;
  rutaId?: string | null;
  cobradorId?: string | null;
  // para promesas:
  tzFallback?: string;   // por si no cargara tz del tenant
};

function ymdFromTimestamp(ts: Timestamp, tz: string): string {
  // reusa todayInTZ para formatear a YYYY-MM-DD de forma robusta
  const d = ts.toDate();
  const y = d.getUTCFullYear();
  // simple, si quieres TZ real necesitas toYYYYMMDDInTZ; por ahora usamos UTC seguro
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchTenantTZ(): Promise<string> {
  try {
    return await resolveTenantTZ();
  } catch {
    return 'America/Sao_Paulo';
  }
}

/** Carga alertas de promesas vencidas (best-effort) */
async function loadPromesasVencidas(
  tenantId: string,
  tz: string,
  rutaId?: string | null,
  cobradorId?: string | null
): Promise<AlertItem[]> {
  const qBase = query(
    collectionGroup(db, 'prestamos'),
    where('tenantId', '==', tenantId),
    where('restante', '>', 0)
  );

  const snap = await getDocs(qBase);
  const today = todayInTZ(tz);
  const out: AlertItem[] = [];

  snap.forEach((d) => {
    const p = d.data() as DocumentData;

    // Obtenemos fecha promesa en varios formatos comunes
    let promesa: string | null = null;

    if (typeof p.promesaPago === 'string') {
      promesa = p.promesaPago; // YYYY-MM-DD (ideal)
    } else if (p.promesaPagoAt instanceof Timestamp) {
      promesa = ymdFromTimestamp(p.promesaPagoAt, tz);
    } else if (typeof p.promesa === 'string') {
      promesa = p.promesa;
    }

    const cumplida = Boolean(p.promesaCumplida ?? p.promesa_cumplida ?? false);
    if (!promesa || cumplida) return;

    // filtros opcionales
    if (rutaId && String(p.rutaId ?? '') !== String(rutaId)) return;
    if (cobradorId && String(p.admin ?? p.cobradorId ?? '') !== String(cobradorId)) return;

    if (promesa < today) {
      const nombre = p.clienteNombre ?? p.nombre ?? p.cliente?.nombre ?? p.clienteId ?? 'Cliente';
      out.push({
        id: `promesa:${d.id}`,
        kind: 'promesa_vencida',
        severity: 'medium',
        date: promesa,
        adminId: p.admin ?? p.cobradorId ?? null,
        rutaId: p.rutaId ?? null,
        message: `Promesa vencida de ${nombre} (restante ${Number(p.restante ?? 0)})`,
        meta: {
          prestamoId: d.id,
          clienteId: p.clienteId ?? p.cliente?.id ?? null,
          restante: Number(p.restante ?? 0),
          diasAtraso: Number(p.diasAtraso ?? 0),
        },
      });
    }
  });

  // ordenar por severidad heurística (mayor restante y más días atraso)
  out.sort((a, b) => {
    const ra = Number(a.meta?.restante ?? 0);
    const rb = Number(b.meta?.restante ?? 0);
    if (rb !== ra) return rb - ra;
    const da = Number(a.meta?.diasAtraso ?? 0);
    const db = Number(b.meta?.diasAtraso ?? 0);
    return db - da;
  });

  return out;
}

/** Listener de cierres faltantes: cuando hay actividad en cajaDiaria un día X para un admin,
 *  pero no existe doc en cierres/{tenantId}/{yyyymmdd}/{admin}
 */
function listenCierresFaltantes(
  opts: AlertsOpts,
  onData: (items: AlertItem[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const { tenantId, from, to, rutaId, cobradorId } = opts;

  const qc: QueryConstraint[] = [
    where('tenantId', '==', tenantId),
    where('operationalDate', '>=', from),
    where('operationalDate', '<=', to),
    orderBy('operationalDate', 'asc'),
  ];
  if (rutaId) qc.push(where('rutaId', '==', rutaId));
  if (cobradorId) qc.push(where('admin', '==', cobradorId));

  const qMain = query(collection(db, 'cajaDiaria'), ...qc);

  // cache para evitar consultas repetidas
  const checked = new Set<string>(); // key: `${date}||${admin}`
  let pending = 0;

  const emitFromMap = async (dayAdminSet: Set<string>) => {
    const alerts: AlertItem[] = [];
    const promises: Promise<void>[] = [];

    dayAdminSet.forEach((key) => {
      if (checked.has(key)) return;
      checked.add(key);

      const [date, admin] = key.split('||');
      const yyyymmdd = date.replaceAll('-', '');

      // path: cierres/{tenantId}/{yyyyMMdd}/{admin}
      const cierreRef = doc(db, 'cierres', tenantId, yyyymmdd, admin || '—');
      pending++;
      promises.push(
        getDoc(cierreRef)
          .then((snap) => {
            const exists = snap.exists();
            if (!exists) {
              alerts.push({
                id: `cierre:${date}:${admin}`,
                kind: 'cierre_faltante',
                severity: 'high',
                date,
                adminId: admin || '—',
                message: `Falta cierre de ${admin || '—'} en ${date}`,
              });
            }
          })
          .catch(() => {
            // si falla el check, no generamos alerta para no confundir
          })
          .finally(() => {
            pending--;
          })
      );
    });

    await Promise.all(promises);
    onData(alerts);
  };

  return onSnapshot(
    qMain,
    (snap) => {
      const dayAdmin = new Set<string>();
      snap.forEach((d) => {
        const data = d.data() as DocumentData;
        const date = String(data.operationalDate);
        const admin = String(data.admin ?? '—');
        const tipo = canonicalTipo(String(data.tipo ?? ''));

        // Consideramos "actividad" cuando hay apertura/abono/ingreso/retiro/prestamo/gasto
        if (!tipo) return;
        dayAdmin.add(`${date}||${admin}`);
      });
      void emitFromMap(dayAdmin);
    },
    (e) => onError?.(e)
  );
}

/** Listener maestro: combina cierres faltantes (realtime) + promesas vencidas (pull inicial y refresh liviano).
 *  Para simplificar, promesas se cargan al montar y cuando cambian los filtros.
 */
export function useAlerts(opts: AlertsOpts) {
  const [list, setList] = React.useState<AlertItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    let buffer: AlertItem[] = [];
    let unsub: Unsubscribe | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      const tz = await fetchTenantTZ();

      // 1) promesas vencidas (pull)
      let promesas: AlertItem[] = [];
      try {
        promesas = await loadPromesasVencidas(opts.tenantId, tz, opts.rutaId, opts.cobradorId);
      } catch (e) {
        console.error(e);
      }

      if (!alive) return;
      buffer = promesas;

      // 2) cierres faltantes (realtime)
      unsub = listenCierresFaltantes(
        opts,
        (faltantes) => {
          if (!alive) return;
          const map = new Map<string, AlertItem>();
          // unidos, dedupe por id
          [...buffer, ...faltantes].forEach((a) => map.set(a.id, a));
          const arr = Array.from(map.values())
            .sort((a, b) => {
              // ordenar por severidad > fecha desc
              const sev = (x: AlertSeverity) => (x === 'high' ? 3 : x === 'medium' ? 2 : 1);
              if (sev(b.severity) !== sev(a.severity)) return sev(b.severity) - sev(a.severity);
              return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
            });
          setList(arr);
          setLoading(false);
        },
        (e) => {
          console.error(e);
          if (!alive) return;
          setError('No se pudieron cargar las alertas.');
          setLoading(false);
        }
      );
    })();

    return () => {
      alive = false;
      if (unsub) unsub();
    };
  }, [opts.tenantId, opts.from, opts.to, opts.rutaId, opts.cobradorId]);

  return { list, loading, error };
}
