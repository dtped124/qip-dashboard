'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { IndicatorData, IndicatorStatus, Campus } from '@/lib/types';
import { STATUS_CONFIG, CATEGORY_COLORS, CATEGORY_ORDER, INDICATOR_META, QUARTERLY_MONTHS, monthToQuarter } from '@/lib/constants';
import { computeMonthStatus } from '@/lib/engine/anomalyDetector';

interface Props {
  indicators: IndicatorData[];
  year: number;
}

const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const statusColorClass: Record<IndicatorStatus, string> = {
  alert:     'bg-red-500',
  warning:   'bg-orange-400',
  watch:     'bg-yellow-400',
  good:      'bg-green-500',
  excellent: 'bg-blue-500',
  neutral:   'bg-gray-200',
};

export function StatusMatrix({ indicators, year }: Props) {
  // 偵測目前院區（從已有的指標推斷）
  const campus: Campus = useMemo(() => {
    if (indicators.length > 0) return indicators[0].campus;
    return '竹北';
  }, [indicators]);

  // 合併：已有資料的指標 + INDICATOR_META 中該院區定義但無資料的指標
  const allIndicators = useMemo(() => {
    const existingKeys = new Set(indicators.map(ind => `${ind.meta.code}_${ind.campus}`));
    const placeholders: IndicatorData[] = [];

    for (const [code, meta] of Object.entries(INDICATOR_META)) {
      if (!meta.isActive || !meta.campuses.includes(campus)) continue;
      const key = `${code}_${campus}`;
      if (existingKeys.has(key)) continue;

      // 建立空的佔位指標
      placeholders.push({
        meta: { code, ...meta },
        campus,
        monthlyData: [],
        yearlySummaries: [],
        latestValue: null,
        latestMonth: null,
        status: 'neutral',
        trend: 'flat',
        benchmarkValue: null,
        peerValue: null,
        peerYear: null,
        anomalies: [],
        controlChart: null,
      });
    }

    return [...indicators, ...placeholders];
  }, [indicators, campus]);

  // 按類別分組
  const grouped = useMemo(() => {
    const map = new Map<string, IndicatorData[]>();
    for (const cat of CATEGORY_ORDER) {
      const items = allIndicators.filter(ind => ind.meta.category === cat);
      if (items.length > 0) {
        map.set(cat, items);
      }
    }
    return map;
  }, [allIndicators]);

  // 計算每個指標每個月的狀態
  const statusMap = useMemo(() => {
    const map = new Map<string, Map<number, IndicatorStatus>>();

    for (const ind of allIndicators) {
      const key = `${ind.meta.code}_${ind.campus}`;
      const monthStatuses = new Map<number, IndicatorStatus>();

      // 季指標只計算 Q1-Q4（month 1,4,7,10），其餘月份顯示 neutral
      const periodsToCompute: readonly number[] = ind.meta.isQuarterly ? QUARTERLY_MONTHS : months;

      for (const m of months) {
        if (periodsToCompute.includes(m)) {
          const status = computeMonthStatus(
            ind.monthlyData,
            year,
            m,
            ind.peerValue,
            ind.meta.direction,
            ind.controlChart,
          );
          monthStatuses.set(m, status);
        } else {
          monthStatuses.set(m, 'neutral');
        }
      }

      map.set(key, monthStatuses);
    }

    return map;
  }, [allIndicators, year]);

  // 統計本年度各狀態數量
  const summary = useMemo(() => {
    const counts: Record<IndicatorStatus, number> = {
      alert: 0, warning: 0, watch: 0, good: 0, excellent: 0, neutral: 0,
    };
    statusMap.forEach((monthStatuses) => {
      monthStatuses.forEach((s) => {
        counts[s]++;
      });
    });
    return counts;
  }, [statusMap]);

  return (
    <div>
      {/* 標題 */}
      <div className="text-sm text-gray-500 mb-2">
        {campus} {allIndicators.length} 項指標 × 12 期
      </div>

      {/* 圖例與摘要 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4 text-xs">
          {(['alert', 'warning', 'watch', 'good', 'excellent', 'neutral'] as IndicatorStatus[]).map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm ${statusColorClass[s]}`} />
              <span className="text-gray-600">{STATUS_CONFIG[s].text}</span>
              <span className="text-gray-400">({summary[s]})</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-400">民國 {year} 年</div>
      </div>

      {/* 評判標準說明 */}
      <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg text-[11px] text-gray-500 leading-relaxed">
        <span className="font-medium text-gray-600">評判標準：</span>
        <span className="text-red-600 font-medium">警示</span> 超出管制圖 3σ 上/下限 |{' '}
        <span className="text-orange-600 font-medium">注意</span> 超出 2σ 或連續 7 點趨勢異常、多重不利因素 |{' '}
        <span className="text-yellow-600 font-medium">留意</span> 月增減 ≥10% 不利 或 同儕比較不利 |{' '}
        <span className="text-green-600 font-medium">良好</span> 無異常 |{' '}
        <span className="text-blue-600 font-medium">卓越</span> 顯著優於管制限且優於同儕 |{' '}
        <span className="text-gray-500 font-medium">監測</span> 該月無資料或為監測型指標
      </div>

      {/* 矩陣表格 */}
      <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-100">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-500 min-w-[200px] border-b border-r border-gray-200">
                指標
              </th>
              {months.map(m => (
                <th key={m} className="px-1 py-2 text-xs font-medium text-gray-500 text-center min-w-[36px] border-b border-gray-200">
                  {m}月
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(grouped.entries()).map(([category, items]) => (
              <>
                {/* 類別標題行 */}
                <tr key={`cat-${category}`}>
                  <td
                    colSpan={13}
                    className="sticky left-0 z-10 bg-gray-50 px-3 py-1.5 text-xs font-semibold border-b border-gray-200"
                    style={{ color: CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] }}
                  >
                    {category}
                  </td>
                </tr>
                {/* 指標行 */}
                {items.map(ind => {
                  const key = `${ind.meta.code}_${ind.campus}`;
                  const monthStatuses = statusMap.get(key);

                  return (
                    <tr key={key} className="hover:bg-gray-50/50 group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-3 py-1 border-b border-r border-gray-100">
                        <Link
                          href={`/indicators/${ind.meta.code}`}
                          className="flex items-center gap-2 text-xs hover:text-blue-600"
                        >
                          <span className="font-mono text-gray-400 w-16 shrink-0">{ind.meta.code}</span>
                          <span className="text-gray-700 truncate max-w-[140px]">{ind.meta.name}</span>
                          {ind.meta.isQuarterly && <span className="text-[10px] text-purple-500 bg-purple-50 px-1 rounded shrink-0">季</span>}
                        </Link>
                      </td>
                      {months.map(m => {
                        const status = monthStatuses?.get(m) ?? 'neutral';
                        // 季指標：非季月（1,4,7,10）不顯示色塊
                        if (ind.meta.isQuarterly && !(QUARTERLY_MONTHS as readonly number[]).includes(m)) {
                          return (
                            <td key={m} className="px-1 py-1 border-b border-gray-50 text-center">
                              <div className="w-6 h-6 mx-auto" />
                            </td>
                          );
                        }
                        const periodLabel = ind.meta.isQuarterly ? `Q${monthToQuarter(m)}` : `${m}月`;
                        return (
                          <td key={m} className="px-1 py-1 border-b border-gray-50 text-center">
                            <Link href={`/indicators/${ind.meta.code}`}>
                              <div
                                className={`w-6 h-6 mx-auto rounded-sm ${statusColorClass[status]} hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 transition-all cursor-pointer`}
                                title={`${ind.meta.code} ${year}年${periodLabel}: ${STATUS_CONFIG[status].text}`}
                              />
                            </Link>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
