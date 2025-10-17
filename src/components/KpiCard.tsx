'use client';
import React from 'react';

export function KpiCard({
  title,
  value,
  formatCurrency,
}: {
  title: string;
  value: number;
  formatCurrency?: boolean;
}) {
  const fmt = (n: number) =>
    formatCurrency
      ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : n.toLocaleString('pt-BR');

  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="text-xs font-bold text-slate-500">{title}</div>
      <div className="text-2xl font-black">{fmt(value)}</div>
    </div>
  );
}
