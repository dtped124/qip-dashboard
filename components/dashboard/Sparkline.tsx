'use client';

import { MonthlyDataPoint } from '@/lib/types';

interface Props {
  data: MonthlyDataPoint[];
  year: number;
  color?: string;
  width?: number;
  height?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Sparkline({ data, year, color = '#3B82F6', width = 120, height = 32 }: Props) {
  // 顯示最近 24 個月的數據（跨 2 年）
  const sorted = [...data]
    .filter(d => d.value !== null)
    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

  // 取最近 24 筆
  const recent = sorted.slice(-24);

  if (recent.length < 2) {
    return (
      <svg width={width} height={height} className="text-gray-200">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth={1} strokeDasharray="2,2" />
      </svg>
    );
  }

  const values = recent.map(d => d.value!);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const padding = 2;
  const usableHeight = height - padding * 2;
  const usableWidth = width - padding * 2;

  const points = recent.map((d, idx) => {
    const x = padding + (idx / (recent.length - 1)) * usableWidth;
    const y = padding + usableHeight - ((d.value! - min) / range) * usableHeight;
    return `${x},${y}`;
  });

  // 最後一個點
  const last = recent[recent.length - 1];
  const lastX = padding + usableWidth;
  const lastY = padding + usableHeight - ((last.value! - min) / range) * usableHeight;

  return (
    <svg width={width} height={height}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
