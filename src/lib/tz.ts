// Utilidades de timezone centralizadas.
// Sin dependencias externas. Calcula YYYY-MM-DD en una TZ dada.

export function toYYYYMMDDInTZ(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) throw new Error('Invalid date parts');
  return `${y}-${m}-${d}`;
}

export function todayInTZ(tz: string): string {
  return toYYYYMMDDInTZ(new Date(), tz);
}

// Mock inicial: en producción, leer de claims o doc de tenant.
export async function resolveTenantTZ(_tenantId?: string | null): Promise<string> {
  return 'America/Sao_Paulo';
}

// Helper opcional para sumar días a un YYYY-MM-DD respetando TZ
export function addDaysYYYYMMDD(yyyyMmDd: string, days: number, tz: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map((n) => parseInt(n, 10));
  // 12:00 UTC para evitar bordes DST
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return toYYYYMMDDInTZ(next, tz);
}
