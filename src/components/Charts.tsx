'use client';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';

export function TimeSeries({ data }: { data: { x: string | number; y: number }[] }) {
  const rows = data.map(d => ({ x: d.x, y: d.y }));
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" /><YAxis /><Tooltip />
          <Line type="monotone" dataKey="y" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StackedBars({ series }: { series: { key: string; data: { x: string | number; y: number }[] }[] }) {
  const xs = series[0]?.data.map(d => d.x) || [];
  const rows = xs.map((x, i) =>
    series.reduce((acc, s) => ({ ...acc, x, [s.key]: s.data[i]?.y ?? 0 }), {} as any)
  );
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" /><YAxis /><Tooltip /><Legend />
          {series.map(s => <Bar key={s.key} dataKey={s.key} stackId="a" />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ data }: { data: { name: string; value: number }[] }) {
  const colors = ['#34d399', '#ef4444', '#3b82f6', '#f59e0b'];
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={70} outerRadius={100} label>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
