'use client';

import { MonthlyDataPoint, IndicatorUnit, ControlChartParams } from '@/lib/types';
import { formatValue, QUARTERLY_MONTHS, monthToQuarter } from '@/lib/constants';

interface Props {
  monthlyData: MonthlyDataPoint[];
  unit: IndicatorUnit;
  isQuarterly?: boolean;
  /** 用來在 dp 沒給 num/den 時，從變動管制限的 sampleSize 回推分母並反算分子 */
  controlChart?: ControlChartParams | null;
}

export function DataTable({ monthlyData, unit, isQuarterly = false, controlChart }: Props) {
  const years = Array.from(new Set(monthlyData.map(d => d.year))).sort((a, b) => b - a);

  const periods = isQuarterly
    ? QUARTERLY_MONTHS.map(m => ({ month: m, label: `Q${monthToQuarter(m)}` }))
    : Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: `${i + 1}月` }));

  // 建立 sampleSize 查找表（key: year_month）
  const sampleSizeMap = new Map<string, number>();
  if (controlChart?.variableLimits) {
    for (const vl of controlChart.variableLimits) {
      sampleSizeMap.set(`${vl.year}_${vl.month}`, vl.sampleSize);
    }
  }

  /** 取分子分母（優先 dp，缺了由 variableLimits.sampleSize + value 回推） */
  function getNumDen(dp: MonthlyDataPoint): { num: number | null; den: number | null } {
    if (dp.numerator != null && dp.denominator != null) {
      return { num: dp.numerator, den: dp.denominator };
    }
    const ss = sampleSizeMap.get(`${dp.year}_${dp.month}`);
    if (ss != null && ss > 0 && dp.value != null) {
      const multiplier = unit === 'permille' ? 1000 : 100;
      const num = Math.round((dp.value / multiplier) * ss);
      return { num, den: ss };
    }
    return { num: null, den: null };
  }

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
                  const { num, den } = dp ? getNumDen(dp) : { num: null, den: null };
                  // 0/0 或分母為 0 視同 NA
                  const isNA = val === null || (den != null && den === 0);
                  const hasND = num != null && den != null && den > 0;
                  return (
                    <td key={p.month} className="text-center px-2 py-2 text-gray-600">
                      {isNA ? (
                        <span className="text-gray-300">-</span>
                      ) : (
                        <>
                          <div>{formatValue(val, unit)}</div>
                          {hasND && (
                            <div className="text-[10px] text-gray-400 leading-tight">
                              {num}/{den}
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
