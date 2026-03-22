'use client';

import { MonthlyDataPoint, YearlySummary, IndicatorUnit } from '@/lib/types';
import { YEAR_COLORS, formatValue, QUARTERLY_MONTHS, monthToQuarter } from '@/lib/constants';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer
} from 'recharts';
import { useState } from 'react';

interface Props {
  monthlyData: MonthlyDataPoint[];
  yearlySummaries: YearlySummary[];
  unit: IndicatorUnit;
  benchmarkValue: number | null;
  isQuarterly?: boolean;
}

export function YearOverlayChart({ monthlyData, unit, benchmarkValue, isQuarterly = false }: Props) {
  const years = Array.from(new Set(monthlyData.map(d => d.year))).sort((a, b) => b - a);
  const [visibleYears, setVisibleYears] = useState<Set<number>>(new Set(years));

  // 將數據轉換為 Recharts 格式：X軸=月份或季度，每年一條線
  const periodMonths = isQuarterly ? [...QUARTERLY_MONTHS] : Array.from({ length: 12 }, (_, i) => i + 1);
  const chartData = periodMonths.map(month => {
    const label = isQuarterly ? `Q${monthToQuarter(month)}` : `${month}月`;
    const point: Record<string, unknown> = { month: label };
    for (const year of years) {
      const dp = monthlyData.find(d => d.year === year && d.month === month);
      point[`y${year}`] = dp?.value ?? null;
    }
    return point;
  });

  const toggleYear = (year: number) => {
    setVisibleYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <div>
      {/* 年度勾選 */}
      <div className="flex flex-wrap gap-3 mb-4">
        {years.map(year => (
          <label key={year} className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={visibleYears.has(year)}
              onChange={() => toggleYear(year)}
              className="rounded"
            />
            <span
              className="w-3 h-0.5 rounded"
              style={{ backgroundColor: YEAR_COLORS[year] || '#999' }}
            />
            {year}年
          </label>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value, name) => {
              const year = String(name).replace('y', '');
              return [formatValue(Number(value), unit), `${year}年`];
            }}
          />
          <Legend />

          {/* 標竿參考線 */}
          {benchmarkValue !== null && (
            <ReferenceLine
              y={benchmarkValue}
              stroke="#EF4444"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{ value: `標竿 ${formatValue(benchmarkValue, unit)}`, position: 'right', fontSize: 11, fill: '#EF4444' }}
            />
          )}

          {/* 年度線條 */}
          {years.map((year, idx) => {
            if (!visibleYears.has(year)) return null;
            const isLatest = idx === 0;
            return (
              <Line
                key={year}
                type="monotone"
                dataKey={`y${year}`}
                name={`y${year}`}
                stroke={YEAR_COLORS[year] || '#999'}
                strokeWidth={isLatest ? 2.5 : idx === 1 ? 1.8 : 1}
                strokeDasharray={idx >= 2 ? '4 4' : undefined}
                dot={isLatest ? { r: 3 } : false}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
