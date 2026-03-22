'use client';

import { YearlySummary, IndicatorUnit } from '@/lib/types';
import { YEAR_COLORS, formatValue } from '@/lib/constants';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';

interface Props {
  yearlySummaries: YearlySummary[];
  unit: IndicatorUnit;
}

export function YearCompareBar({ yearlySummaries, unit }: Props) {
  const data = yearlySummaries
    .filter(s => s.average !== null)
    .map(s => ({
      name: `${s.year}年`,
      value: s.average,
      year: s.year,
    }));

  if (data.length === 0) {
    return <div className="text-sm text-gray-400 text-center py-8">無年度平均值資料</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip
          formatter={(value) => [formatValue(Number(value), unit), '年均值']}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={YEAR_COLORS[entry.year] || '#3B82F6'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
