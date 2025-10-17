'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format } from 'date-fns';
import { KpiCard } from '@/components/KpiCard';
import { TimeSeries, StackedBars, Donut } from '@/components/Charts';

function today() {
  return format(new Date(), 'yyyy-MM-dd');
}

// Tipo mínimo para lo que lees en cajaDiaria
type MovimientoDoc = {
  tipo?: 'apertura' | 'abono' | 'gasto' | 'ingreso' | 'retiro' | 'prestamo';
  monto?: number | string;
};

export default function Dashboard() {
  const [kpi, setKpi] = useState({
    cobrado: 0, prestado: 0, gastos: 0, ingresos: 0, retiros: 0, inicial: 0, morosidadPct: 0,
  });

  const from = today();
  const to = today();
  const tenantId = 'TENANT_DEMO';

  useEffect(() => {
    const q = query(
      collection(db, 'cajaDiaria'),
      where('tenantId', '==', tenantId),
      where('operationalDate', '>=', from),
      where('operationalDate', '<=', to),
      orderBy('operationalDate', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      let cobrado = 0, prestado = 0, gastos = 0, ingresos = 0, retiros = 0, inicial = 0;
      snap.forEach((d) => {
        const it = d.data() as DocumentData as MovimientoDoc; // 👈 sin any
        const monto = Number(it.monto ?? 0);
        switch (it.tipo) {
          case 'apertura': inicial += monto; break;
          case 'abono': cobrado += monto; break;
          case 'gasto': gastos += monto; break;
          case 'ingreso': ingresos += monto; break;
          case 'retiro': retiros += monto; break;
          case 'prestamo': prestado += monto; break;
          default: break;
        }
      });
      setKpi({ cobrado, prestado, gastos, ingresos, retiros, inicial, morosidadPct: 0 });
    });
    return () => unsub();
  }, [tenantId, from, to]);

  const cajaFinal = kpi.inicial + kpi.cobrado + kpi.ingresos - kpi.retiros - kpi.prestado - kpi.gastos;

  const serieIngresos = useMemo(
    () => [{ x: from, y: kpi.cobrado }],
    [kpi.cobrado, from]
  );

  const seriesStacked = useMemo(
    () => ([
      { key: 'prestado', data: [{ x: from, y: kpi.prestado }] },
      { key: 'cobrado',  data: [{ x: from, y: kpi.cobrado  }] },
      { key: 'gastos',   data: [{ x: from, y: kpi.gastos   }] },
    ]),
    [kpi.prestado, kpi.cobrado, kpi.gastos, from]
  );

  const donut = useMemo(
    () => ([
      { name: 'Activos', value: Math.max(1 - kpi.morosidadPct, 0.01) },
      { name: 'En atraso', value: Math.max(kpi.morosidadPct, 0.01) },
    ]),
    [kpi.morosidadPct]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Cobrado" value={kpi.cobrado} />
        <KpiCard title="Prestado" value={kpi.prestado} />
        <KpiCard title="Gastos" value={kpi.gastos} />
        <KpiCard title="Caja Final" value={cajaFinal} formatCurrency />
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-3">
          <h3 className="font-bold mb-2">Ingresos (hoy)</h3>
          <TimeSeries data={serieIngresos} />
        </div>

        <div className="bg-white rounded-xl border p-3">
          <h3 className="font-bold mb-2">Préstamos vs Cobros vs Gastos</h3>
          <StackedBars series={seriesStacked} />
        </div>

        <div className="bg-white rounded-xl border p-3">
          <h3 className="font-bold mb-2">Morosidad</h3>
          <Donut data={donut} />
        </div>
      </section>
    </div>
  );
}
