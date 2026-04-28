'use client';

import { MonthlyDataPoint, IndicatorUnit } from '@/lib/types';
import { formatValue, QUARTERLY_MONTHS, monthToQuarter } from '@/lib/constants';

interface Props {
  monthlyData: MonthlyDataPoint[];
  unit: IndicatorUnit;
  isQuarterly?: boolean;
}

export function DataTable({ monthlyData, unit, isQuarterly = false }: Props) {
  const years = Array.from(new Set(monthlyData.map(d => d.year))).sort((a, b) => b - a);

  const periods = isQuarterly
    ? QUARTERLY_MONTHS.map(m => ({ month: m, label: `Q${monthToQuarter(m)}` }))
    : Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: `${i + 1}月` }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left px-3 py-2 font-medium text-gray-500">年度</th>
            {periods.map(p => (
              <th key={p.month} className="text-center px-2 py-2 font-medium text-gray-500">
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map(year => {
            const yearData = monthlyData
              .filter(d => d.year === year)
              .sort((a, b) => a.month - b.month);

            return (
              <tr key={year} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-700">{year}年</td>
                {periods.map(p => {
                  const dp = yearData.find(d => d.month === p.month);
                  const val = dp?.value ?? null;
                  // 0/0 視同 NA；分子分母都有效才顯示 (num/den)
                  const hasND =
                    dp?.numerator != null &&
                    dp?.denominator != null &&
                    dp.denominator > 0;
                  const isNA = val === null || (dp?.denominator === 0);
                  return (
                    <td key={p.month} className="text-center px-2 py-2 text-gray-600">
                      {isNA ? (
                        <span className="text-gray-300">-</span>
                      ) : (
                        <>
                          <div>{formatValue(val, unit)}</div>
                          {hasND && (
                            <div className="text-[10px] text-gray-400 leading-tight">
                              {dp!.numerator}/{dp!.denominator}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
