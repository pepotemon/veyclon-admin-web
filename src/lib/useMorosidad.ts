'use client';

import * as React from 'react';
import {
  collectionGroup,
  onSnapshot,
  query,
  where,
  DocumentData,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type MorosoItem = {
  prestamoId: string;
  clienteId?: string;
  nombre?: string;
  restante: number;
  diasAtraso?: number;
  rutaId?: string | null;
  admin?: string | null;
};

export type MorosidadStats = {
  activos: number;
  enAtraso: number;
  ratio: number; // 0..1
  top: MorosoItem[];
  loading: boolean;
  error?: string | null;
};

type Opts = {
  tenantId: string | null | undefined;
  rutaId?: string | null;
  cobradorId?: string | null;
  limitTop?: number;
};

export function useMorosidad(opts: Opts): MorosidadStats {
  const { tenantId, rutaId, cobradorId, limitTop = 10 } = opts || {};
  const [state, setState] = React.useState<MorosidadStats>({
    activos: 0,
    enAtraso: 0,
    ratio: 0,
    top: [],
    loading: true,
    error: null,
  });

  React.useEffect(() => {
    if (!tenantId) {
      setState((s) => ({ ...s, loading: false, error: null, activos: 0, enAtraso: 0, ratio: 0, top: [] }));
      return;
    }

    // Base: prestamos activos (restante > 0) del tenant
    // Nota: asumimos que cada préstamo tiene tenantId (o equivalente). Si en tu modelo el campo se llama distinto,
    // cámbialo aquí (p.ej. companyId, orgId, etc.).
    const qBase = query(
      collectionGroup(db, 'prestamos'),
      where('tenantId', '==', tenantId),
      where('restante', '>', 0)
    );

    let unsub: Unsubscribe | null = null;
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      unsub = onSnapshot(
        qBase,
        (snap) => {
          const all: DocumentData[] = [];
          snap.forEach((d) => all.push({ id: d.id, ...d.data() }));

          // Filtrado en memoria por ruta/admin solo si vienen definidos (algunos modelos no lo tienen en el préstamo)
          const filtered = all.filter((p) => {
            if (rutaId && String(p.rutaId || '') !== String(rutaId)) return false;
            if (cobradorId && String(p.admin || p.cobradorId || '') !== String(cobradorId)) return false;
            return true;
          });

          const activos = filtered.length;
          const enAtrasoItems = filtered.filter((p) => {
            // criterio simple y robusto:
            // 1) si hay diasAtraso > 0 => en atraso
            // 2) si no hay diasAtraso, consideramos atraso si p.atraso === true (por si lo guardas)
            const da = Number(p.diasAtraso ?? 0);
            const flag = Boolean(p.atraso ?? false);
            return da > 0 || flag;
          });

          const enAtraso = enAtrasoItems.length;
          const ratio = activos > 0 ? enAtraso / activos : 0;

          // Top morosos: por “restante” desc y fallback por diasAtraso desc
          const top = [...enAtrasoItems]
            .sort((a, b) => {
              const r = Number(b.restante ?? 0) - Number(a.restante ?? 0);
              if (r !== 0) return r;
              return Number(b.diasAtraso ?? 0) - Number(a.diasAtraso ?? 0);
            })
            .slice(0, limitTop)
            .map((p) => ({
              prestamoId: String(p.id),
              clienteId: p.clienteId ?? p.cliente?.id ?? undefined,
              nombre: p.clienteNombre ?? p.nombre ?? p.cliente?.nombre ?? undefined,
              restante: Number(p.restante ?? 0),
              diasAtraso: Number(p.diasAtraso ?? 0),
              rutaId: p.rutaId ?? null,
              admin: p.admin ?? p.cobradorId ?? null,
            }));

          setState({ activos, enAtraso, ratio, top, loading: false, error: null });
        },
        (err) => {
          console.error(err);
          setState((s) => ({ ...s, loading: false, error: 'No se pudo cargar morosidad.' }));
        }
      );
    } catch (e) {
      console.error(e);
      setState((s) => ({ ...s, loading: false, error: 'No se pudo cargar morosidad.' }));
    }

    return () => { if (unsub) unsub(); };
  }, [tenantId, rutaId, cobradorId, limitTop]);

  return state;
}
