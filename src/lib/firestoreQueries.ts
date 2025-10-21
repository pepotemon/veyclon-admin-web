import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
  QueryConstraint,
  Unsubscribe,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

/* =========================
   Tipos de dominio mínimos
========================= */

export type CanonicalTipo =
  | 'apertura'
  | 'abono'
  | 'gasto'
  | 'ingreso'
  | 'retiro'
  | 'prestamo';

export type MovimientoCaja = {
  id: string;
  tenantId: string;
  admin?: string;             // cobrador
  rutaId?: string;
  // tipoReal = lo que viene del documento (p. ej. "gasto_admin")
  tipo: string;
  monto: number;
  operationalDate: string;    // YYYY-MM-DD
  createdAt?: any;
  clienteId?: string;
  clienteNombre?: string | null; // ← NUEVO: para UI sin IDs
  prestamoId?: string;
};

export type CajaAggregates = {
  inicial: number;
  cobrado: number;
  prestado: number;
  gastos: number;
  ingresos: number;
  retiros: number;
  byDate: Record<string, number>; // ejemplo: suma de cobros por día
  byTipo: Record<string, number>; // cuenta por tipo CANÓNICO
};

export function calcCajaFinal(a: Pick<CajaAggregates, 'inicial'|'cobrado'|'ingresos'|'retiros'|'prestado'|'gastos'>) {
  return a.inicial + a.cobrado + a.ingresos - a.retiros - a.prestado - a.gastos;
}

/* =========================
   Normalización de tipos
   - Gasto: SOLO gasto_admin
   - Ingreso/Retiro: cualquier "ingreso*" / "retiro*"
========================= */
export function canonicalTipo(t: string): CanonicalTipo | undefined {
  const v = String(t || '').toLowerCase();
  if (v === 'apertura') return 'apertura';
  if (v === 'abono') return 'abono';
  if (v === 'gasto_admin') return 'gasto';        // <- solo gastos de admin
  if (v.startsWith('ingreso')) return 'ingreso';  // ingreso, ingreso_admin, etc.
  if (v.startsWith('retiro')) return 'retiro';    // retiro, retiro_admin, etc.
  if (v === 'prestamo') return 'prestamo';
  return undefined;
}

/* =========================
   Query builder base (caja)
========================= */

export function buildCajaQuery(opts: {
  tenantId: string;
  from: string;
  to: string;
  cobradorId?: string | null;
  rutaId?: string | null;
}) {
  const qc: QueryConstraint[] = [
    where('tenantId', '==', opts.tenantId),
    where('operationalDate', '>=', opts.from),
    where('operationalDate', '<=', opts.to),
    orderBy('operationalDate', 'asc'),
  ];
  if (opts.cobradorId) qc.push(where('admin', '==', opts.cobradorId));
  if (opts.rutaId) qc.push(where('rutaId', '==', opts.rutaId));
  return query(collection(db, 'cajaDiaria'), ...qc);
}

/* =========================
   Utilidades de fecha/cierre
========================= */

function prevYYYYMMDD(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map((n) => parseInt(n, 10));
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - 1);
  const y2 = date.getUTCFullYear();
  const m2 = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d2 = String(date.getUTCDate()).padStart(2, '0');
  return `${y2}-${m2}-${d2}`;
}

/** Calcula el cierre (cajaFinal) de un día exacto (una sola fecha) con la misma lógica de filtros,
 *  pero asegurando incluir gasto_admin aunque no tenga rutaId. */
async function getDayClosing(opts: {
  tenantId: string;
  date: string; // YYYY-MM-DD
  cobradorId?: string | null;
  rutaId?: string | null;
}): Promise<number> {
  // Query principal (respeta rutaId si viene)
  const qMain = buildCajaQuery({
    tenantId: opts.tenantId,
    from: opts.date,
    to: opts.date,
    cobradorId: opts.cobradorId,
    rutaId: opts.rutaId,
  });

  // Si hay rutaId, agregamos query EXTRA para gasto_admin sin ruta
  let extraDocs: DocumentData[] = [];
  if (opts.rutaId) {
    const qcExtra: QueryConstraint[] = [
      where('tenantId', '==', opts.tenantId),
      where('operationalDate', '>=', opts.date),
      where('operationalDate', '<=', opts.date),
      where('tipo', '==', 'gasto_admin'),
      orderBy('operationalDate', 'asc'),
    ];
    if (opts.cobradorId) qcExtra.push(where('admin', '==', opts.cobradorId));
    const qExtra = query(collection(db, 'cajaDiaria'), ...qcExtra);
    const snapExtra = await getDocs(qExtra);
    extraDocs = snapExtra.docs.map((d) => d.data());
  }

  const snap = await getDocs(qMain);

  let inicial = 0, cobrado = 0, prestado = 0, gastos = 0, ingresos = 0, retiros = 0;
  const allDocs: DocumentData[] = [...snap.docs.map((d) => d.data() as DocumentData), ...extraDocs];

  for (const d of allDocs) {
    const ct = canonicalTipo(String(d.tipo ?? ''));
    if (!ct) continue;
    const monto = Number(d.monto ?? 0);
    if (ct === 'apertura') inicial += monto;
    else if (ct === 'abono') cobrado += monto;
    else if (ct === 'prestamo') prestado += monto;
    else if (ct === 'gasto') gastos += monto;     // solo gasto_admin
    else if (ct === 'ingreso') ingresos += monto; // ingreso*
    else if (ct === 'retiro') retiros += monto;   // retiro*
  }

  return calcCajaFinal({ inicial, cobrado, ingresos, retiros, prestado, gastos });
}

/* ==========================================
   Listener de movimientos + agregados global
   + Arrastre de inicial desde día anterior.
   + Inclusión de gasto_admin sin ruta cuando se filtra por ruta.
========================================== */

export function listenCajaMovimientos(
  opts: {
    tenantId: string;
    from: string;
    to: string;
    cobradorId?: string | null;
    rutaId?: string | null;
  },
  onData: (rows: MovimientoCaja[], agg: CajaAggregates) => void,
  onError?: (e: any) => void
): Unsubscribe {
  // Query principal (puede filtrar por rutaId)
  const qMain = buildCajaQuery(opts);

  // Si hay rutaId, preparamos una query EXTRA para traer gasto_admin sin ruta
  let unsubExtra: Unsubscribe | null = null;
  const startExtraListener = () => {
    if (!opts.rutaId) return null;
    const qc: QueryConstraint[] = [
      where('tenantId', '==', opts.tenantId),
      where('operationalDate', '>=', opts.from),
      where('operationalDate', '<=', opts.to),
      where('tipo', '==', 'gasto_admin'),
      orderBy('operationalDate', 'asc'),
    ];
    if (opts.cobradorId) qc.push(where('admin', '==', opts.cobradorId));
    const qExtra = query(collection(db, 'cajaDiaria'), ...qc);
    return onSnapshot(qExtra, () => {}, onError);
  };

  // Variables para unir ambos streams
  let cacheMain: DocumentData[] = [];
  let cacheExtra: DocumentData[] = [];

  const emit = async () => {
    // Unimos docs (sin duplicar por id)
    const map = new Map<string, DocumentData>();
    for (const d of cacheMain) map.set(d.__docId ?? `${d._id ?? ''}|${d.createdAtMs ?? Math.random()}`, d);
    for (const d of cacheExtra) map.set(d.__docId ?? `${d._id ?? ''}|${d.createdAtMs ?? Math.random()}`, d);
    const docs = Array.from(map.values());

    // ---- Procesamiento con arrastre de inicial ----
    const rows: MovimientoCaja[] = [];

    type DayAcc = {
      apertura: number;
      cobrado: number;
      prestado: number;
      gastos: number;
      ingresos: number;
      retiros: number;
    };
    const byDay: Record<string, DayAcc> = {};
    const byTipo: Record<string, number> = {};
    const byDate: Record<string, number> = {};

    for (const d of docs) {
      const realTipo = String(d.tipo ?? '');
      const ct = canonicalTipo(realTipo);
      if (!ct) continue;
      const monto = Number(d.monto ?? 0);
      const day = String(d.operationalDate);

      rows.push({
        id: d.__docId ?? `${d._id ?? ''}|${d.createdAtMs ?? Math.random()}`,
        tenantId: d.tenantId,
        admin: d.admin,
        rutaId: d.rutaId,
        tipo: realTipo,
        monto,
        operationalDate: day,
        createdAt: d.createdAt,
        clienteId: d.clienteId,
        clienteNombre: d.clienteNombre ?? d?.cliente?.nombre ?? null, // ← NUEVO
        prestamoId: d.prestamoId,
      });

      if (!byDay[day]) byDay[day] = { apertura: 0, cobrado: 0, prestado: 0, gastos: 0, ingresos: 0, retiros: 0 };

      if (ct === 'apertura') byDay[day].apertura += monto;
      else if (ct === 'abono') {
        byDay[day].cobrado += monto;
        byDate[day] = (byDate[day] ?? 0) + monto;
      }
      else if (ct === 'prestamo') byDay[day].prestado += monto;
      else if (ct === 'gasto') byDay[day].gastos += monto;       // solo gasto_admin
      else if (ct === 'ingreso') byDay[day].ingresos += monto;   // ingreso*
      else if (ct === 'retiro') byDay[day].retiros += monto;     // retiro*

      byTipo[ct] = (byTipo[ct] ?? 0) + monto;
    }

    const daysSorted = Object.keys(byDay).sort(); // asc
    const inicialByDay: Record<string, number> = {};
    let prevWithin = 0;
    for (const day of daysSorted) {
      const a = byDay[day];
      const inicial = a.apertura > 0 ? a.apertura : prevWithin;
      inicialByDay[day] = inicial;
      const cierre = calcCajaFinal({
        inicial,
        cobrado: a.cobrado,
        ingresos: a.ingresos,
        retiros: a.retiros,
        prestado: a.prestado,
        gastos: a.gastos,
      });
      prevWithin = cierre;
    }

    // Primer día sin apertura -> mirar día anterior
    if (daysSorted.length > 0) {
      const firstDay = daysSorted[0];
      if (byDay[firstDay].apertura === 0 && inicialByDay[firstDay] === 0) {
        try {
          const prevDay = prevYYYYMMDD(firstDay);
          const prevClosing = await getDayClosing({
            tenantId: opts.tenantId,
            date: prevDay,
            cobradorId: opts.cobradorId,
            rutaId: opts.rutaId,
          });

          let runningPrev = prevClosing;
          for (const day of daysSorted) {
            const a = byDay[day];
            const inicial = day === firstDay ? prevClosing : (a.apertura > 0 ? a.apertura : runningPrev);
            inicialByDay[day] = inicial;
            const cierre = calcCajaFinal({
              inicial,
              cobrado: a.cobrado,
              ingresos: a.ingresos,
              retiros: a.retiros,
              prestado: a.prestado,
              gastos: a.gastos,
            });
            runningPrev = cierre;
          }
        } catch { /* noop */ }
      }
    }

    // Agregados globales
    let inicial = 0, cobrado = 0, prestado = 0, gastos = 0, ingresos = 0, retiros = 0;
    for (const day of daysSorted) {
      const a = byDay[day];
      inicial += (inicialByDay[day] ?? 0);
      cobrado += a.cobrado;
      prestado += a.prestado;
      gastos += a.gastos;
      ingresos += a.ingresos;
      retiros += a.retiros;
    }

    onData(rows, { inicial, cobrado, prestado, gastos, ingresos, retiros, byDate, byTipo });
  };

  const unsubMain = onSnapshot(
    qMain,
    (snap) => {
      cacheMain = snap.docs.map((doc) => ({ ...doc.data(), __docId: doc.id }) as DocumentData);
      emit();
    },
    onError
  );

  if (opts.rutaId) {
    unsubExtra = onSnapshot(
      query(
        collection(db, 'cajaDiaria'),
        where('tenantId', '==', opts.tenantId),
        where('operationalDate', '>=', opts.from),
        where('operationalDate', '<=', opts.to),
        where('tipo', '==', 'gasto_admin'),
        orderBy('operationalDate', 'asc'),
        ...(opts.cobradorId ? [where('admin', '==', opts.cobradorId)] : [])
      ),
      (snap) => {
        cacheExtra = snap.docs.map((doc) => ({ ...doc.data(), __docId: doc.id }) as DocumentData);
        emit();
      },
      onError
    );
  }

  // Devuelve un unsub que cierra ambos listeners
  return () => {
    unsubMain();
    if (unsubExtra) unsubExtra();
  };
}

/* ======================================
   Agregados por día y por cobrador (UI Cierres)
   + Arrastre de inicial en totales.
   + Inclusión de gasto_admin sin ruta cuando se filtra por ruta.
====================================== */

export type DailyAdminAgg = {
  adminId: string; // puede ser undefined -> mostramos '—'
  inicial: number;
  cobrado: number;
  prestado: number;
  gastos: number;
  ingresos: number;
  retiros: number;
  cajaFinal: number;
};

export type DailySummary = {
  date: string; // YYYY-MM-DD
  totals: DailyAdminAgg;    // totales del día (adminId: 'TOTAL')
  admins: DailyAdminAgg[];  // desglose por cobrador
};

export function listenCierresAggregates(
  opts: {
    tenantId: string;
    from: string;
    to: string;
    rutaId?: string | null;
    cobradorId?: string | null;
  },
  onData: (days: DailySummary[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  // Principal
  const qMain = buildCajaQuery(opts);

  // Caches
  let cacheMain: DocumentData[] = [];
  let cacheExtra: DocumentData[] = [];

  const emit = async () => {
    const map = new Map<string, DocumentData>();
    for (const d of cacheMain) map.set(d.__docId ?? `${d._id ?? ''}|${d.createdAtMs ?? Math.random()}`, d);
    for (const d of cacheExtra) map.set(d.__docId ?? `${d._id ?? ''}|${d.createdAtMs ?? Math.random()}`, d);
    const docs = Array.from(map.values());

    const byDayAdmins: Record<string, Record<string, Omit<DailyAdminAgg, 'cajaFinal'|'adminId'>>> = {};
    const byDayTotals: Record<string, Omit<DailyAdminAgg, 'cajaFinal'|'adminId'>> = {};
    const aperturaByDay: Record<string, number> = {};

    for (const d of docs) {
      const day = String(d.operationalDate);
      const admin = String(d.admin ?? '—');
      const ct = canonicalTipo(String(d.tipo ?? ''));
      if (!ct) continue;
      const monto = Number(d.monto ?? 0);

      if (!byDayAdmins[day]) byDayAdmins[day] = {};
      if (!byDayAdmins[day][admin]) byDayAdmins[day][admin] = { inicial: 0, cobrado: 0, prestado: 0, gastos: 0, ingresos: 0, retiros: 0 };
      if (!byDayTotals[day]) byDayTotals[day] = { inicial: 0, cobrado: 0, prestado: 0, gastos: 0, ingresos: 0, retiros: 0 };
      if (!aperturaByDay[day]) aperturaByDay[day] = 0;

      const A = byDayAdmins[day][admin];
      const T = byDayTotals[day];

      if (ct === 'apertura') { A.inicial += monto; T.inicial += monto; aperturaByDay[day] += monto; }
      else if (ct === 'abono') { A.cobrado += monto; T.cobrado += monto; }
      else if (ct === 'prestamo') { A.prestado += monto; T.prestado += monto; }
      else if (ct === 'gasto') { A.gastos += monto; T.gastos += monto; }       // SOLO gasto_admin
      else if (ct === 'ingreso') { A.ingresos += monto; T.ingresos += monto; } // ingreso*
      else if (ct === 'retiro') { A.retiros += monto; T.retiros += monto; }    // retiro*
    }

    const daysSorted = Object.keys(byDayTotals).sort(); // asc
    const out: DailySummary[] = daysSorted.map((day) => {
      const admins: DailyAdminAgg[] = Object.entries(byDayAdmins[day] || {}).map(([adminId, a]) => ({
        adminId,
        ...a,
        cajaFinal: 0,
      }));
      const totals: DailyAdminAgg = {
        adminId: 'TOTAL',
        ...byDayTotals[day],
        cajaFinal: 0,
      };
      return { date: day, totals, admins };
    });

    // Arrastre de inicial en TOTALES
    let prevCierre = 0;
    for (let i = 0; i < out.length; i++) {
      const d = out[i];
      const hadApertura = (aperturaByDay[d.date] ?? 0) > 0;
      if (!hadApertura) d.totals.inicial += prevCierre;

      d.totals.cajaFinal = calcCajaFinal(d.totals);
      prevCierre = d.totals.cajaFinal;

      d.admins = d.admins.map((a) => ({
        ...a,
        cajaFinal: calcCajaFinal(a),
      }));
    }

    // Primer día sin apertura -> leer cierre de día anterior
    if (out.length > 0) {
      const first = out[0];
      const hadAperturaFirst = (aperturaByDay[first.date] ?? 0) > 0;
      if (!hadAperturaFirst && first.totals.inicial === 0) {
        try {
          const prevDay = prevYYYYMMDD(first.date);
          const closing = await getDayClosing({
            tenantId: opts.tenantId,
            date: prevDay,
            cobradorId: opts.cobradorId,
            rutaId: opts.rutaId,
          });

          let runningPrev = closing;
          for (let i = 0; i < out.length; i++) {
            const d = out[i];
            const hadApertura = (aperturaByDay[d.date] ?? 0) > 0;
            const add = !hadApertura ? runningPrev : 0;
            d.totals.inicial += add;
            d.totals.cajaFinal = calcCajaFinal(d.totals);
            runningPrev = d.totals.cajaFinal;

            d.admins = d.admins.map((a) => ({
              ...a,
              cajaFinal: calcCajaFinal(a),
            }));
          }
        } catch { /* noop */ }
      }
    }

    // Orden descendente para UI
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    onData(out);
  };

  const unsubMain = onSnapshot(
    qMain,
    (snap) => {
      cacheMain = snap.docs.map((doc) => ({ ...doc.data(), __docId: doc.id }) as DocumentData);
      emit();
    },
    onError
  );

  // Extra sólo si hay rutaId
  let unsubExtra: Unsubscribe | null = null;
  if (opts.rutaId) {
    unsubExtra = onSnapshot(
      query(
        collection(db, 'cajaDiaria'),
        where('tenantId', '==', opts.tenantId),
        where('operationalDate', '>=', opts.from),
        where('operationalDate', '<=', opts.to),
        where('tipo', '==', 'gasto_admin'),
        orderBy('operationalDate', 'asc'),
        ...(opts.cobradorId ? [where('admin', '==', opts.cobradorId)] : [])
      ),
      (snap) => {
        cacheExtra = snap.docs.map((doc) => ({ ...doc.data(), __docId: doc.id }) as DocumentData);
        emit();
      },
      onError
    );
  }

  return () => {
    unsubMain();
    if (unsubExtra) unsubExtra();
  };
}
