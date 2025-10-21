'use client';

import * as React from 'react';
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
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { canonicalTipo } from '@/lib/firestoreQueries';

/* =========================
   Tipos públicos
========================= */

export type AuditType =
  | 'cobro'
  | 'prestamo'
  | 'gasto_admin'
  | 'gasto_cobrador'
  | 'ingreso'
  | 'retiro'
  | 'apertura'
  | 'usuario'
  | 'config'
  | 'otro';

export type AuditRow = {
  id: string;
  tenantId: string;
  type: AuditType;
  ts: number;               // ms epoch
  date: string;             // YYYY-MM-DD
  admin?: string | null;    // cobrador/actor
  rutaId?: string | null;

  // Cliente (mostrar nombre; NO mostrar ID en UI)
  clienteId?: string | null;          // solo para lógica interna
  clienteNombre?: string | null;      // para UI

  // Préstamo (mostrar valor; NO mostrar ID en UI)
  prestamoId?: string | null;         // solo para lógica interna
  prestamoValor?: number | null;      // para UI (si está disponible)

  amount?: number | null;   // monto genérico del evento
  message?: string | null;  // detalle/categoría/notas
  raw: DocumentData;        // para inspección
  label: string;            // descripción corta para UI (sin redundancias)
};

/* =========================
   Helpers de normalización
========================= */

function toYYYYMMDDUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pickTsMs(d: DocumentData): number | null {
  if (typeof d.createdAtMs === 'number') return d.createdAtMs;
  if (d.createdAt instanceof Timestamp) return d.createdAt.toMillis();
  if (typeof d.tsMs === 'number') return d.tsMs;
  if (d.ts instanceof Timestamp) return d.ts.toMillis();
  return null;
}

function pickDateStr(d: DocumentData, fallbackMs: number | null): string {
  if (typeof d.operationalDate === 'string') return d.operationalDate;
  if (typeof d.date === 'string') return d.date;
  if (fallbackMs != null) return toYYYYMMDDUtc(new Date(fallbackMs));
  return toYYYYMMDDUtc(new Date());
}

function normalizeType(t: any): AuditType {
  const v = String(t ?? '').toLowerCase();
  if (v === 'abono' || v === 'cobro') return 'cobro';
  if (v === 'prestamo') return 'prestamo';
  if (v === 'gasto_admin') return 'gasto_admin';
  if (v === 'gasto_cobrador') return 'gasto_cobrador';
  if (v.startsWith('ingreso')) return 'ingreso';
  if (v.startsWith('retiro')) return 'retiro';
  if (v === 'apertura') return 'apertura';
  if (v.includes('user') || v === 'usuario') return 'usuario';
  if (v.includes('config') || v.includes('rule')) return 'config';
  return 'otro';
}

/** Regla de “Detalle”:
 *  - cobro / prestamo: vacío
 *  - gasto_admin / gasto_cobrador / ingreso / retiro: solo message (sin tipo/monto)
 *  - apertura: message si existe; si no, vacío
 *  - usuario/config/otro: message si existe
 */
function buildLabel(a: AuditRow): string {
  const msg = (a.message ?? '').toString().trim();
  switch (a.type) {
    case 'cobro':
    case 'prestamo':
      return ''; // sin detalle
    case 'gasto_admin':
    case 'gasto_cobrador':
    case 'ingreso':
    case 'retiro':
      return msg; // solo el detalle relevante (p. ej. "manual", "Transporte")
    case 'apertura':
      return msg; // solo si hay descripción; si no, queda vacío
    case 'usuario':
    case 'config':
    default:
      return msg;
  }
}

function readClienteNombre(d: DocumentData): string | null {
  return (
    d.clienteNombre ??
    d.nombre ??
    d.cliente?.nombre ??
    d.cliente?.displayName ??
    d.cliente_name ??
    null
  );
}

function readPrestamoValor(d: DocumentData, type: AuditType, amount: number | null): number | null {
  const valor =
    (typeof d.valorPrestamo === 'number' ? d.valorPrestamo : undefined) ??
    (typeof d.valor === 'number' ? d.valor : undefined) ??
    (typeof d.montoPrestamo === 'number' ? d.montoPrestamo : undefined) ??
    (typeof d.capital === 'number' ? d.capital : undefined) ??
    undefined;

  if (typeof valor === 'number') return valor;
  if (type === 'prestamo' && typeof amount === 'number') return amount;
  return null;
}

function toAuditRow(docId: string, d: DocumentData): AuditRow {
  const ms = pickTsMs(d);
  const date = pickDateStr(d, ms);
  const type = normalizeType(d.type ?? d.tipo ?? d.eventType);
  const amount =
    typeof d.monto === 'number'
      ? d.monto
      : typeof d.amount === 'number'
      ? d.amount
      : null;

  const row: AuditRow = {
    id: docId,
    tenantId: d.tenantId,
    type,
    ts: ms ?? new Date(date).getTime(),
    date,
    admin: d.admin ?? d.actor ?? null,
    rutaId: d.rutaId ?? null,

    clienteId: d.clienteId ?? d.cliente?.id ?? null,
    clienteNombre: readClienteNombre(d),

    prestamoId: d.prestamoId ?? d.prestamo?.id ?? null,
    prestamoValor: readPrestamoValor(d, type, amount),

    amount,
    message: d.message ?? d.nota ?? d.descripcion ?? d.categoria ?? d.source ?? null,
    raw: d,
    label: '',
  };
  row.label = buildLabel(row);
  return row;
}

/* =========================
   Listener unificado
========================= */

type ListenOpts = {
  tenantId: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  rutaId?: string | null;
  cobradorId?: string | null;
  typeFilter?: AuditType | 'all';
};

export function listenAuditLogs(
  opts: ListenOpts,
  onData: (rows: AuditRow[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const { tenantId, from, to, rutaId, cobradorId } = opts;

  const baseWhere: QueryConstraint[] = [
    where('tenantId', '==', tenantId),
    where('operationalDate', '>=', from),
    where('operationalDate', '<=', to),
    orderBy('operationalDate', 'desc'),
  ];
  if (rutaId) baseWhere.push(where('rutaId', '==', rutaId));
  if (cobradorId) baseWhere.push(where('admin', '==', cobradorId));

  const listeners: Unsubscribe[] = [];
  let caches: DocumentData[] = [];
  let fallbackCache: DocumentData[] = [];
  let gotAnyFromAudit = false;

  const emit = () => {
    const allDocs = gotAnyFromAudit ? caches : fallbackCache;
    let rows = allDocs.map((d: any) => toAuditRow(d.__id || d.id || Math.random().toString(36), d));
    if (opts.typeFilter && opts.typeFilter !== 'all') {
      rows = rows.filter((r) => r.type === opts.typeFilter);
    }
    rows.sort((a, b) => (b.ts - a.ts) || (a.id < b.id ? -1 : 1));
    onData(rows);
  };

  // 1) auditLogs raíz
  try {
    const q1 = query(collection(db, 'auditLogs'), ...baseWhere);
    listeners.push(onSnapshot(q1, (snap) => {
      const arr: DocumentData[] = [];
      snap.forEach((d) => arr.push({ __id: d.id, ...d.data() }));
      if (arr.length) gotAnyFromAudit = true;
      caches = mergeUniqueById(caches, arr);
      emit();
    }, (e) => onError?.(e)));
  } catch {}

  // 2) tenants/{tenantId}/auditLogs
  try {
    const q2 = query(collection(db, 'tenants', tenantId, 'auditLogs'), ...baseWhere);
    listeners.push(onSnapshot(q2, (snap) => {
      const arr: DocumentData[] = [];
      snap.forEach((d) => arr.push({ __id: d.id, ...d.data() }));
      if (arr.length) gotAnyFromAudit = true;
      caches = mergeUniqueById(caches, arr);
      emit();
    }, (e) => onError?.(e)));
  } catch {}

  // 3) collectionGroup('auditLogs')
  try {
    const q3 = query(
      collectionGroup(db, 'auditLogs'),
      where('tenantId', '==', tenantId),
      where('operationalDate', '>=', from),
      where('operationalDate', '<=', to),
      orderBy('operationalDate', 'desc'),
      ...(rutaId ? [where('rutaId', '==', rutaId)] : []),
      ...(cobradorId ? [where('admin', '==', cobradorId)] : [])
    );
    listeners.push(onSnapshot(q3, (snap) => {
      const arr: DocumentData[] = [];
      snap.forEach((d) => arr.push({ __id: d.id, ...d.data() }));
      if (arr.length) gotAnyFromAudit = true;
      caches = mergeUniqueById(caches, arr);
      emit();
    }, (e) => onError?.(e)));
  } catch {}

  // 4) FALLBACK: cajaDiaria -> eventos sintéticos (sin redundancias en label)
  try {
    const qc: QueryConstraint[] = [
      where('tenantId', '==', tenantId),
      where('operationalDate', '>=', from),
      where('operationalDate', '<=', to),
      orderBy('operationalDate', 'desc'),
    ];
    if (rutaId) qc.push(where('rutaId', '==', rutaId));
    if (cobradorId) qc.push(where('admin', '==', cobradorId));
    const qFallback = query(collection(db, 'cajaDiaria'), ...qc);

    listeners.push(onSnapshot(qFallback, (snap) => {
      const arr: DocumentData[] = [];
      snap.forEach((doc) => {
        const d = doc.data() as DocumentData;
        const ct = canonicalTipo(String(d.tipo ?? ''));
        if (!ct) return;

        const amount =
          typeof d.monto === 'number' ? d.monto
          : typeof d.amount === 'number' ? d.amount
          : null;

        const mapped: DocumentData = {
          __id: `synth:${doc.id}`,
          tenantId: d.tenantId,
          operationalDate: d.operationalDate,
          admin: d.admin ?? null,
          rutaId: d.rutaId ?? null,

          clienteId: d.clienteId ?? null,
          clienteNombre: d.clienteNombre ?? d.nombre ?? d.cliente?.nombre ?? null,

          prestamoId: d.prestamoId ?? null,
          valorPrestamo:
            typeof d.valorPrestamo === 'number' ? d.valorPrestamo
            : typeof d.valor === 'number' ? d.valor
            : typeof d.capital === 'number' ? d.capital
            : ct === 'prestamo' ? amount
            : null,

          monto: amount,
          createdAtMs: typeof d.createdAtMs === 'number' ? d.createdAtMs : undefined,
          createdAt: d.createdAt instanceof Timestamp ? d.createdAt : undefined,
          type:
            ct === 'abono' ? 'cobro'
            : ct === 'prestamo' ? 'prestamo'
            : ct === 'gasto' ? (String(d.tipo).toLowerCase() === 'gasto_cobrador' ? 'gasto_cobrador' : 'gasto_admin')
            : ct === 'ingreso' ? 'ingreso'
            : ct === 'retiro' ? 'retiro'
            : ct === 'apertura' ? 'apertura'
            : 'otro',
          // detalle sólo de campos útiles
          message: d.categoria ?? d.nota ?? d.descripcion ?? d.source ?? null,
        };
        arr.push(mapped);
      });

      if (!gotAnyFromAudit) {
        fallbackCache = arr;
        emit();
      }
    }, (e) => onError?.(e)));
  } catch {}

  return () => {
    listeners.forEach((u) => { try { u(); } catch {} });
  };
}

/* =========================
   Utils
========================= */

function mergeUniqueById(prev: DocumentData[], next: DocumentData[]) {
  const map = new Map<string, DocumentData>();
  for (const d of prev) map.set(String(d.__id ?? d.id), d);
  for (const d of next) map.set(String(d.__id ?? d.id), d);
  return Array.from(map.values());
}
