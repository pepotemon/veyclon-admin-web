'use client';
import * as React from 'react';

function formatPct(x: number) {
  return new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 0 }).format(x);
}

export default function DonutMorosidad({
  activos,
  enAtraso,
  size = 160,
  stroke = 16,
}: {
  activos: number;
  enAtraso: number;
  size?: number;
  stroke?: number;
}) {
  const ratio = activos > 0 ? enAtraso / activos : 0;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const filled = circ * ratio;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            className="text-neutral-200 dark:text-neutral-800"
            stroke="currentColor"
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={`${filled} ${circ - filled}`}
            strokeLinecap="round"
            className="text-rose-500"
            stroke="currentColor"
            fill="none"
          />
        </g>
        <text
          x="50%"
          y="48%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-current"
          style={{ fontSize: 18, fontWeight: 700 }}
        >
          {formatPct(ratio)}
        </text>
        <text
          x="50%"
          y="62%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-neutral-500"
          style={{ fontSize: 12 }}
        >
          En atraso
        </text>
      </svg>

      <div className="text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
          <span>En atraso: <b>{enAtraso}</b></span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="inline-block h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
          <span>Activos: <b>{activos}</b></span>
        </div>
      </div>
    </div>
  );
}
