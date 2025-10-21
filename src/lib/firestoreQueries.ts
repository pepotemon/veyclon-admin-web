import {
  collection,
  collectionGroup,
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
  rutaId?: string | null;
  // tipoReal = lo que viene del documento (p. ej. "gasto_admin")
  tipo: string;
  monto: number;
  operationalDate: string;    // YYYY-MM-DD
  createdAt?: unknown;
  clienteId?: string;
  clienteNombre?: string | null;
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
  if (opts.rutaId !== undefined && opts.rutaId !== null) {
    qc.push(where('rutaId', '==', opts.rutaId));
  }
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
 *  + incluye gasto_admin sin ruta (cuando se filtra por ruta)
 *  + incluye préstamos DEMO (source='demo') aunque no tengan ruta.
 */
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
    rutaId: opts.rutaId ?? undefined,
  });

  // Extra 1: gasto_admin sin ruta cuando se filtra por ruta
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

  // Extra 2: préstamos DEMO del día (siempre se incluyen)
  const cgConstraints: QueryConstraint[] = [
    where('tenantId', '==', opts.tenantId),
    where('fechaInicio', '>=', opts.date),
    where('fechaInicio', '<=', opts.date),
    where('source', '==', 'demo'),
    orderBy('fechaInicio', 'asc'),
  ];
  if (opts.cobradorId) cgConstraints.push(where('creadoPor', '==', opts.cobradorId));
  const qPrestDemo = query(collectionGroup(db, 'prestamos'), ...cgConstraints);
  const snapPrestDemo = await getDocs(qPrestDemo);
  const demoDocs = snapPrestDemo.docs.map((d) => ({ ...d.data(), __kind: 'prest_demo' } as DocumentData));

  const snap = await getDocs(qMain);

  let inicial = 0, cobrado = 0, prestado = 0, gastos = 0, ingresos = 0, retiros = 0;
  const allDocs: DocumentData[] = [
    ...snap.docs.map((d) => d.data() as DocumentData),
    ...extraDocs,
    ...demoDocs,
  ];

  for (const d of allDocs) {
    const isPrestamoDemo = (d as DocumentData).__kind === 'prest_demo';
    const ct = isPrestamoDemo ? 'prestamo' : canonicalTipo(String((d as DocumentData).tipo ?? ''));
    if (!ct) continue;

    const monto = isPrestamoDemo
      ? Number((d as DocumentData).totalPrestamo ?? (d as DocumentData).montoTotal ?? 0)
      : Number((d as DocumentData).monto ?? 0);

    if (ct === 'apertura') inicial += monto;
    else if (ct === 'abono') cobrado += monto;
    else if (ct === 'prestamo') prestado += monto;
    else if (ct === 'gasto') gastos += monto;
    else if (ct === 'ingreso') ingresos += monto;
    else if (ct === 'retiro') retiros += monto;
  }

  return calcCajaFinal({ inicial, cobrado, ingresos, retiros, prestado, gastos });
}

/* ==================================================================
   Listener de movimientos + agregados (CAJA) con préstamos DEMO
================================================================== */

export function listenCajaMovimientos(
  opts: {
    tenantId: string;
    from: string;
    to: string;
    cobradorId?: string | null;
    rutaId?: string | null;
  },
  onData: (rows: MovimientoCaja[], agg: CajaAggregates) => void,
  onError?: (e: unknown) => void
): Unsubscribe {
  // 1) cajaDiaria principal
  const qMain = buildCajaQuery({
    tenantId: opts.tenantId,
    from: opts.from,
    to: opts.to,
    cobradorId: opts.cobradorId,
    rutaId: opts.rutaId ?? undefined,
  });

  // 2) préstamos DEMO
  const cgConstraints: QueryConstraint[] = [
    where('tenantId', '==', opts.tenantId),
    where('fechaInicio', '>=', opts.from),
    where('fechaInicio', '<=', opts.to),
    where('source', '==', 'demo'),
    orderBy('fechaInicio', 'asc'),
  ];
  if (opts.cobradorId) cgConstraints.push(where('creadoPor', '==', opts.cobradorId));
  const qPrestDemo = query(collectionGroup(db, 'prestamos'), ...cgConstraints);

  // caches
  let cacheMain: DocumentData[] = [];
  let cachePrest: DocumentData[] = [];

  const emit = async () => {
    const map = new Map<string, DocumentData>();

    // cajaDiaria
    for (const d of cacheMain) map.set((d as DocumentData).__docId ?? `caja|${(d as DocumentData)._id ?? ''}|${(d as DocumentData).createdAtMs ?? Math.random()}`, d);

    // prestamos demo
    for (const d of cachePrest) map.set(
      (d as DocumentData).__docId ?? `prest|${(d as DocumentData).prestamoId ?? ''}|${(d as DocumentData).createdAtMs ?? Math.random()}`,
      d
    );

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

    for (const dd of docs) {
      const d = dd as DocumentData;
      const isPrestamoDemo = d.__kind === 'prest_demo';
      const realTipo = String(d.tipo ?? '').toLowerCase();
      const ct = isPrestamoDemo ? ('prestamo' as const) : canonicalTipo(realTipo);
      if (!ct) continue;

      const monto = isPrestamoDemo
        ? Number(d.totalPrestamo ?? d.montoTotal ?? 0)
        : Number(d.monto ?? 0);

      const day = isPrestamoDemo
        ? String(d.fechaInicio)
        : String(d.operationalDate);

      const admin = isPrestamoDemo
        ? (String(d.creadoPor ?? '').trim() || undefined)
        : d.admin;

      // Filtrado por cobrador seleccionado
      if (opts.cobradorId && admin !== opts.cobradorId) continue;

      // Filtrado por ruta:
      // - prestamos demo NO tienen ruta -> siempre pasan
      // - normales sí filtran por ruta si se especifica
      const rId = isPrestamoDemo ? null : (d.rutaId ?? null);
      if (opts.rutaId && !isPrestamoDemo && rId !== opts.rutaId) continue;

      rows.push({
        id: d.__docId ?? `${isPrestamoDemo ? 'prest' : 'caja'}|${d._id ?? ''}|${d.createdAtMs ?? Math.random()}`,
        tenantId: d.tenantId ?? opts.tenantId,
        admin,
        rutaId: rId,
        tipo: isPrestamoDemo ? 'prestamo' : (d.tipo as string),
        monto,
        operationalDate: day,
        createdAt: d.createdAt,
        clienteId: d.clienteId,
        clienteNombre: isPrestamoDemo ? (d.clienteAlias ?? d.concepto ?? null) : (d.clienteNombre ?? d?.cliente?.nombre ?? null),
        prestamoId: d.prestamoId,
      });

      if (!byDay[day]) byDay[day] = { apertura: 0, cobrado: 0, prestado: 0, gastos: 0, ingresos: 0, retiros: 0 };

      if (!isPrestamoDemo) {
        // cajaDiaria
        const cct = canonicalTipo(realTipo);
        if (cct === 'apertura') byDay[day].apertura += monto;
        else if (cct === 'abono') {
          byDay[day].cobrado += monto;
          byDate[day] = (byDate[day] ?? 0) + monto;
        } else if (cct === 'prestamo') byDay[day].prestado += monto;
        else if (cct === 'gasto') byDay[day].gastos += monto;       // solo gasto_admin
        else if (cct === 'ingreso') byDay[day].ingresos += monto;   // ingreso*
        else if (cct === 'retiro') byDay[day].retiros += monto;     // retiro*
        if (cct) byTipo[cct] = (byTipo[cct] ?? 0) + monto;
      } else {
        // prest demo -> siempre suma a 'prestado'
        byDay[day].prestado += monto;
        byTipo['prestamo'] = (byTipo['prestamo'] ?? 0) + monto;
      }
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

    // Primer día sin apertura -> mirar día anterior (incluye demo y gasto_admin sin ruta)
    if (daysSorted.length > 0) {
      const firstDay = daysSorted[0];
      if (byDay[firstDay].apertura === 0 && inicialByDay[firstDay] === 0) {
        try {
          const prevDay = prevYYYYMMDD(firstDay);
          const prevClosing = await getDayClosing({
            tenantId: opts.tenantId,
            date: prevDay,
            cobradorId: opts.cobradorId,
            rutaId: opts.rutaId ?? undefined,
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
        } catch {
          /* noop */
        }
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

  const unsubPrest = onSnapshot(
    qPrestDemo,
    (snap) => {
      cachePrest = snap.docs.map((doc) => ({
        ...doc.data(),
        __docId: doc.id,
        __kind: 'prest_demo',
      }) as DocumentData);
      emit();
    },
    onError
  );

  // Devuelve un unsub que cierra ambos listeners
  return () => {
    unsubMain();
    unsubPrest();
  };
}

/* ===========================================================
   Agregados por día/cobrador (CIERRES) incluyendo préstamos DEMO
=========================================================== */

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
  onError?: (e: unknown) => void
): Unsubscribe {
  // Principal
  const qMain = buildCajaQuery({
    tenantId: opts.tenantId,
    from: opts.from,
    to: opts.to,
    cobradorId: opts.cobradorId,
    rutaId: opts.rutaId ?? undefined,
  });

  // Préstamos DEMO
  const cgConstraints: QueryConstraint[] = [
    where('tenantId', '==', opts.tenantId),
    where('fechaInicio', '>=', opts.from),
    where('fechaInicio', '<=', opts.to),
    where('source', '==', 'demo'),
    orderBy('fechaInicio', 'asc'),
  ];
  if (opts.cobradorId) cgConstraints.push(where('creadoPor', '==', opts.cobradorId));
  const qPrestDemo = query(collectionGroup(db, 'prestamos'), ...cgConstraints);

  // Caches
  let cacheMain: DocumentData[] = [];
  let cachePrest: DocumentData[] = [];

  const emit = async () => {
    const map = new Map<string, DocumentData>();
    for (const d of cacheMain) map.set((d as DocumentData).__docId ?? `caja|${(d as DocumentData)._id ?? ''}|${(d as DocumentData).createdAtMs ?? Math.random()}`, d);
    for (const d of cachePrest) map.set((d as DocumentData).__docId ?? `prest|${(d as DocumentData).prestamoId ?? ''}|${(d as DocumentData).createdAtMs ?? Math.random()}`, d);
    const docs = Array.from(map.values());

    const byDayAdmins: Record<string, Record<string, Omit<DailyAdminAgg, 'cajaFinal'|'adminId'>>> = {};
    const byDayTotals: Record<string, Omit<DailyAdminAgg, 'cajaFinal'|'adminId'>> = {};
    const aperturaByDay: Record<string, number> = {};

    for (const dd of docs) {
      const d = dd as DocumentData;
      const isPrestamoDemo = d.__kind === 'prest_demo';
      const ct = isPrestamoDemo ? 'prestamo' : canonicalTipo(String(d.tipo ?? ''));

      if (!ct) continue;

      const monto = isPrestamoDemo
        ? Number(d.totalPrestamo ?? d.montoTotal ?? 0)
        : Number(d.monto ?? 0);

      const day = isPrestamoDemo ? String(d.fechaInicio) : String(d.operationalDate);
      const admin = isPrestamoDemo ? String(d.creadoPor ?? '—') : String(d.admin ?? '—');

      // filtros
      if (opts.cobradorId && admin !== opts.cobradorId) continue;

      // Con rutaId: prestamos demo también se contabilizan (no filtran por ruta)
      const rId = isPrestamoDemo ? null : (d.rutaId ?? null);
      if (opts.rutaId && !isPrestamoDemo && rId !== opts.rutaId) continue;

      if (!byDayAdmins[day]) byDayAdmins[day] = {};
      if (!byDayAdmins[day][admin]) byDayAdmins[day][admin] = { inicial: 0, cobrado: 0, prestado: 0, gastos: 0, ingresos: 0, retiros: 0 };
      if (!byDayTotals[day]) byDayTotals[day] = { inicial: 0, cobrado: 0, prestado: 0, gastos: 0, ingresos: 0, retiros: 0 };
      if (!aperturaByDay[day]) aperturaByDay[day] = 0;

      const A = byDayAdmins[day][admin];
      const T = byDayTotals[day];

      if (!isPrestamoDemo) {
        if (ct === 'apertura') { A.inicial += monto; T.inicial += monto; aperturaByDay[day] += monto; }
        else if (ct === 'abono') { A.cobrado += monto; T.cobrado += monto; }
        else if (ct === 'prestamo') { A.prestado += monto; T.prestado += monto; }
        else if (ct === 'gasto') { A.gastos += monto; T.gastos += monto; }
        else if (ct === 'ingreso') { A.ingresos += monto; T.ingresos += monto; }
        else if (ct === 'retiro') { A.retiros += monto; T.retiros += monto; }
      } else {
        A.prestado += monto;
        T.prestado += monto;
      }
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
            rutaId: opts.rutaId ?? undefined,
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
        } catch {
          /* noop */
        }
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

  const unsubPrest = onSnapshot(
    qPrestDemo,
    (snap) => {
      cachePrest = snap.docs.map((doc) => ({
        ...doc.data(),
        __docId: doc.id,
        __kind: 'prest_demo',
      }) as DocumentData);
      emit();
    },
    onError
  );

  return () => {
    unsubMain();
    unsubPrest();
  };
}
