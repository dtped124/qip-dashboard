'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { IndicatorData, IndicatorStatus, Campus } from '@/lib/types';
import { STATUS_CONFIG, CATEGORY_COLORS, CATEGORY_ORDER, INDICATOR_META, QUARTERLY_MONTHS } from '@/lib/constants';
import { computeMonthStatus } from '@/lib/engine/anomalyDetector';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { aggregateToQuarterly } from '@/lib/aggregation';

interface Props {
  indicators: IndicatorData[];
  year: number;
}

/** A (year, month) period slot for columns */
interface PeriodSlot {
  year: number;
  month: number;
  label: string;
}

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

  const statusFilter = useDashboardStore(s => s.statusFilter);
  const periodMode = useDashboardStore(s => s.periodMode);
  const isQuarterlyView = periodMode === 'quarterly';

  // 合併：已有資料的指標 + INDICATOR_META 中該院區定義但無資料的指標
  const allIndicators = useMemo(() => {
    if (statusFilter === 'alert') {
      return indicators;
    }

    const existingKeys = new Set(indicators.map(ind => `${ind.meta.code}_${ind.campus}`));
    const placeholders: IndicatorData[] = [];

    for (const [code, meta] of Object.entries(INDICATOR_META)) {
      if (!meta.isActive || !meta.campuses.includes(campus)) continue;
      const key = `${code}_${campus}`;
      if (existingKeys.has(key)) continue;

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
  }, [indicators, campus, statusFilter]);

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

  // 計算滾動期間欄位：月度最近 12 個月 / 季度最近 8 季
  const periodSlots: PeriodSlot[] = useMemo(() => {
    if (isQuarterlyView) {
      // 最近 8 季
      const slots: PeriodSlot[] = [];
      let y = year;
      let q = 1; // 起始：目前年份的最新季（Q1 = month 1）

      // 找所有指標中最新的資料點來決定終點
      let maxYear = year;
      let maxMonth = 1;
      for (const ind of allIndicators) {
        for (const dp of ind.monthlyData) {
          if (dp.value !== null) {
            if (dp.year > maxYear || (dp.year === maxYear && dp.month > maxMonth)) {
              maxYear = dp.year;
              maxMonth = dp.month;
            }
          }
        }
      }
      // 終點季度
      const endQuarter = Math.ceil(maxMonth / 3);
      y = maxYear;
      q = endQuarter;

      // 從終點往回產生 8 季
      for (let i = 0; i < 8; i++) {
        const month = QUARTERLY_MONTHS[q - 1]; // 1,4,7,10
        slots.unshift({
          year: y,
          month,
          label: `${y}.Q${q}`,
        });
        q--;
        if (q < 1) { q = 4; y--; }
      }
      return slots;
    } else {
      // 最近 12 個月
      // 找所有指標中最新的資料點
      let maxYear = year;
      let maxMonth = 1;
      for (const ind of allIndicators) {
        for (const dp of ind.monthlyData) {
          if (dp.value !== null) {
            if (dp.year > maxYear || (dp.year === maxYear && dp.month > maxMonth)) {
              maxYear = dp.year;
              maxMonth = dp.month;
            }
          }
        }
      }

      const slots: PeriodSlot[] = [];
      let y = maxYear;
      let m = maxMonth;
      for (let i = 0; i < 12; i++) {
        slots.unshift({
          year: y,
          month: m,
          label: `${y}.${String(m).padStart(2, '0')}`,
        });
        m--;
        if (m < 1) { m = 12; y--; }
      }
      return slots;
    }
  }, [year, isQuarterlyView, allIndicators]);

  // 計算每個指標每期的狀態
  const statusMap = useMemo(() => {
    const map = new Map<string, Map<string, IndicatorStatus>>();

    for (const ind of allIndicators) {
      const key = `${ind.meta.code}_${ind.campus}`;
      const periodStatuses = new Map<string, IndicatorStatus>();

      // 決定要用的資料
      const isNativeQuarterly = ind.meta.isQuarterly;
      const needsAggregation = isQuarterlyView && !isNativeQuarterly;
      const dataForStatus = needsAggregation
        ? aggregateToQuarterly(ind.monthlyData, ind.meta.dataNature, ind.meta.unit)
        : ind.monthlyData;

      for (const slot of periodSlots) {
        const periodKey = `${slot.year}_${slot.month}`;

        // 月度檢視下，原生季指標只在季月（1,4,7,10）有值
        if (!isQuarterlyView && isNativeQuarterly && !(QUARTERLY_MONTHS as readonly number[]).includes(slot.month)) {
          periodStatuses.set(periodKey, 'neutral');
          continue;
        }

        const status = computeMonthStatus(
          dataForStatus,
          slot.year,
          slot.month,
          ind.peerValue,
          ind.meta.direction,
          ind.controlChart,
        );
        periodStatuses.set(periodKey, status);
      }

      map.set(key, periodStatuses);
    }

    return map;
  }, [allIndicators, periodSlots, isQuarterlyView]);

  // 統計各狀態數量
  const summary = useMemo(() => {
    const counts: Record<IndicatorStatus, number> = {
      alert: 0, warning: 0, watch: 0, good: 0, excellent: 0, neutral: 0,
    };
    statusMap.forEach((periodStatuses) => {
      periodStatuses.forEach((s) => {
        counts[s]++;
      });
    });
    return counts;
  }, [statusMap]);

  const periodCount = isQuarterlyView ? 8 : 12;
  const periodLabel = isQuarterlyView ? '季' : '月';

  return (
    <div>
      {/* 標題 */}
      <div className="text-sm text-gray-500 mb-2">
        {campus} {allIndicators.length} 項指標 × 最近 {periodCount} {periodLabel}
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
              <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 text-xs font-medium text-gray-500 min-w-[340px] border-b border-r border-gray-200">
                指標
              </th>
              {periodSlots.map(slot => (
                <th key={slot.label} className={`px-1 py-2 text-xs font-medium text-gray-500 text-center border-b border-gray-200 ${isQuarterlyView ? 'min-w-[56px]' : 'min-w-[44px]'}`}>
                  {slot.label}
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
                    colSpan={periodSlots.length + 1}
                    className="sticky left-0 z-10 bg-gray-50 px-3 py-1.5 text-xs font-semibold border-b border-gray-200"
                    style={{ color: CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] }}
                  >
                    {category}
                  </td>
                </tr>
                {/* 指標行 */}
                {items.map(ind => {
                  const key = `${ind.meta.code}_${ind.campus}`;
                  const periodStatuses = statusMap.get(key);

                  return (
                    <tr key={key} className="hover:bg-gray-50/50 group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-3 py-1 border-b border-r border-gray-100">
                        <Link
                          href={`/indicators/${ind.meta.code}`}
                          className="flex items-center gap-2 text-xs hover:text-blue-600"
                        >
                          <span className="font-mono text-gray-400 w-16 shrink-0">{ind.meta.code}</span>
                          <span className="text-gray-700 truncate max-w-[280px]">{ind.meta.name}</span>
                          {ind.meta.isQuarterly && <span className="text-[10px] text-purple-500 bg-purple-50 px-1 rounded shrink-0">季</span>}
                        </Link>
                      </td>
                      {periodSlots.map(slot => {
                        const periodKey = `${slot.year}_${slot.month}`;
                        let status = periodStatuses?.get(periodKey) ?? 'neutral';
                        // 篩選模式下，良好/卓越改為灰色
                        if (statusFilter === 'alert' && (status === 'good' || status === 'excellent')) {
                          status = 'neutral';
                        }
                        // 月度檢視下，原生季指標非季月不顯示色塊
                        if (!isQuarterlyView && ind.meta.isQuarterly && !(QUARTERLY_MONTHS as readonly number[]).includes(slot.month)) {
                          return (
                            <td key={slot.label} className="px-1 py-1 border-b border-gray-50 text-center">
                              <div className="w-6 h-6 mx-auto" />
                            </td>
                          );
                        }
                        return (
                          <td key={slot.label} className="px-1 py-1 border-b border-gray-50 text-center">
                            <Link href={`/indicators/${ind.meta.code}`}>
                              <div
                                className={`${isQuarterlyView ? 'w-8 h-6' : 'w-6 h-6'} mx-auto rounded-sm ${statusColorClass[status]} hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 transition-all cursor-pointer`}
                                title={`${ind.meta.code} ${slot.label}: ${STATUS_CONFIG[status].text}`}
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
