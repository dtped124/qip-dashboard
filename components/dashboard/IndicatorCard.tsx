'use client';

import { IndicatorData } from '@/lib/types';
import { formatValue, CATEGORY_COLORS } from '@/lib/constants';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { latestQuarterlyValue } from '@/lib/aggregation';
import { StatusBadge } from './StatusBadge';
import { TrendArrow } from './TrendArrow';
import { Sparkline } from './Sparkline';
import Link from 'next/link';

const MECHANISM_LABELS: Record<string, string> = {
  control_chart: '管制圖',
  monthly_change: '月增減',
  peer_comparison: '同儕比較',
};

interface Props {
  indicator: IndicatorData;
}

export function IndicatorCard({ indicator }: Props) {
  const { meta, latestValue, latestMonth, status, trend, benchmarkValue, peerValue, peerSource, monthlyData, yearlySummaries, anomalies } = indicator;
  const periodMode = useDashboardStore(s => s.periodMode);
  const color = CATEGORY_COLORS[meta.category];

  // 找最新月份（給異常判定用 — 無論月/季模式都基於最新月份的不利異常）
  const validPoints = monthlyData
    .filter(dp => dp.value !== null)
    .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
  const latestPoint = validPoints[0];

  // 季模式：顯示最近完整季的值與標籤；月模式：維持現狀
  const quarterly = periodMode === 'quarterly'
    ? latestQuarterlyValue(monthlyData, meta.dataNature, meta.unit)
    : null;
  const displayValue = quarterly ? quarterly.value : latestValue;
  const displayPeriod = quarterly ? quarterly.label : latestMonth;

  // 只取最新月份的不利異常（與 status 判定邏輯一致）
  const latestUnfavorable = latestPoint
    ? anomalies.filter(a =>
        a.direction === 'unfavorable' &&
        a.year === latestPoint.year &&
        a.month === latestPoint.month
      )
    : [];
  const unfavorableCount = latestUnfavorable.length;

  // 觸發規則（最新月份，去重）
  const mechanisms = Array.from(new Set(latestUnfavorable.map(a => MECHANISM_LABELS[a.mechanism]).filter(Boolean)));

  // 取得前一年平均
  const sortedSummaries = [...yearlySummaries].sort((a, b) => b.year - a.year);
  const prevYear = sortedSummaries.length > 1 ? sortedSummaries[1] : null;

  // 最新年度
  const latestYear = sortedSummaries[0]?.year || 115;

  return (
    <Link
      href={`/indicators/${meta.code}`}
      className="block bg-white rounded-lg shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow cursor-pointer"
    >
      {/* 頂部：狀態燈號 + 指標代碼 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} size="sm" />
          <span className="text-xs font-mono text-gray-500">{meta.code}</span>
          {unfavorableCount > 0 && (
            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
              {unfavorableCount}
            </span>
          )}
        </div>
        <span
          className="w-1.5 h-6 rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>

      {/* 指標名稱 */}
      <h3 className="text-sm font-medium text-gray-800 mb-3 line-clamp-2 leading-tight">
        {meta.name}
      </h3>

      {/* 最新值 + Sparkline */}
      <div className="flex items-end justify-between mb-2">
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {formatValue(displayValue, meta.unit)}
          </div>
          {displayPeriod && (
            <div className="text-xs text-gray-400 mt-0.5">{displayPeriod}</div>
          )}
        </div>
        <Sparkline data={monthlyData} year={latestYear} color={color} />
      </div>

      {/* 異常觸發規則 */}
      {mechanisms.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {mechanisms.map(m => (
            <span key={m} className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded">
              {m}
            </span>
          ))}
        </div>
      )}

      {/* 底部：標竿 + 趨勢 */}
      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-50">
        <div>
          {peerValue !== null ? (
            <span>{peerSource === 'TCPI' ? 'TCPI' : '同儕'}: {formatValue(peerValue, meta.unit)}</span>
          ) : benchmarkValue !== null ? (
            <span>標竿: {formatValue(benchmarkValue, meta.unit)}</span>
          ) : null}
        </div>
        <TrendArrow trend={trend} isReverse={meta.isReverse} />
      </div>

      {/* 前一年平均 */}
      {prevYear && prevYear.average !== null && (
        <div className="text-xs text-gray-400 mt-1">
          {prevYear.year}年均: {formatValue(prevYear.average, meta.unit)}
        </div>
      )}
    </Link>
  );
}
