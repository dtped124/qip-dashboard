'use client';

/**
 * 達文西指標卡 — 版型 1:1 鏡射 QIP 的 components/dashboard/IndicatorCard：
 * 燈號徽章 + mono 代碼 + 異常數紅圈 + 面向色條 / 名稱 / 大字值 + Sparkline /
 * 觸發規則 tags / 底部標竿 + 趨勢箭頭 / 前期均值。
 * 直接複用 QIP 的 StatusBadge / TrendArrow / Sparkline（僅 import，不修改）。
 *
 * 達文西差異（依定案）：比率型大字顯示 分子/分母（0 事件顯示 0/15 而非 0%），
 * 百分比為輔；連續型顯示 平均 + 中位數。
 */

import Link from 'next/link';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TrendArrow } from '@/components/dashboard/TrendArrow';
import { Sparkline } from '@/components/dashboard/Sparkline';
import type {
  DavinciIndicatorMeta,
  DavinciPeriodGroup,
  DavinciPeriodKey,
} from '../lib/types';
import { DAVINCI_COLOR, WER_RULE_LABELS, periodToYearMonth, unitLabel } from '../lib/ui';

interface Props {
  meta: DavinciIndicatorMeta;
  groups: DavinciPeriodGroup[];      // 全期別（遞增）
  selectedPeriod: DavinciPeriodKey;
}

export function IndicatorCard({ meta, groups, selectedPeriod }: Props) {
  const series = groups.map(g => ({
    period: g.period,
    label: g.period_label,
    row: g.indicators.find(r => r.code === meta.code) ?? null,
  }));
  const idx = groups.findIndex(g => g.period === selectedPeriod);
  const current = idx >= 0 ? series[idx] : null;
  const prev = idx > 0 ? series[idx - 1] : null;

  const unit = unitLabel(meta.unit);

  // 期增減趨勢（七項皆越低越好 → isReverse=false：下降=綠）
  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (current?.row?.value != null && prev?.row?.value != null) {
    if (current.row.value > prev.row.value) trend = 'up';
    else if (current.row.value < prev.row.value) trend = 'down';
  }

  // Sparkline 資料（轉 QIP MonthlyDataPoint 形狀；季模式取季末月座標）
  const sparkData = series
    .filter(s => s.row?.value != null)
    .map(s => ({ ...periodToYearMonth(s.period), value: s.row!.value }));
  const latestYear = sparkData.length > 0 ? sparkData[sparkData.length - 1].year : 115;

  // 觸發規則 tags（本期不利訊號，去重）
  const ruleTags = Array.from(new Set(
    (current?.row?.signals ?? []).map(s => WER_RULE_LABELS[s.rule] ?? s.rule),
  ));
  const unfavorableCount = current?.row?.signals.length ?? 0;

  const rating = current?.row?.rating ?? 'neutral';

  return (
    <Link
      href={`/davinci/${meta.code}`}
      className="block bg-white rounded-lg shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow cursor-pointer"
    >
      {/* 頂部：狀態燈號 + 指標代碼 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <StatusBadge status={rating} size="sm" />
          <span className="text-xs font-mono text-gray-500">{meta.code}</span>
          {unfavorableCount > 0 && (
            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
              {unfavorableCount}
            </span>
          )}
        </div>
        <span
          className="w-1.5 h-6 rounded-full"
          style={{ backgroundColor: DAVINCI_COLOR }}
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
            {current?.row ? (
              meta.kind === 'rate' ? (
                // 0 事件顯示 0/15 而非 0%（定案）
                <>
                  {current.row.numerator}
                  <span className="text-lg font-normal text-gray-400">/{current.row.denominator}</span>
                </>
              ) : (
                <>
                  {current.row.value ?? '—'}
                  <span className="text-sm font-normal text-gray-400 ml-0.5">{unit}</span>
                </>
              )
            ) : '—'}
          </div>
          {current && (
            <div className="text-xs text-gray-400 mt-0.5">
              {current.label}
              {meta.kind === 'rate' && current.row?.value != null && `・${current.row.value}%`}
              {meta.kind === 'continuous' && current.row?.median_value != null && `・中位 ${current.row.median_value}`}
            </div>
          )}
        </div>
        <Sparkline data={sparkData} year={latestYear} color={DAVINCI_COLOR} />
      </div>

      {/* 異常觸發規則 */}
      {ruleTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {ruleTags.map(m => (
            <span key={m} className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded">
              {m}
            </span>
          ))}
        </div>
      )}

      {/* 底部：標竿 + 趨勢 */}
      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-50">
        <div>
          <span className="text-gray-400">標竿: —（待設定）</span>
        </div>
        <TrendArrow trend={trend} isReverse={false} />
      </div>

      {/* 前期值 */}
      {prev?.row && prev.row.value != null && (
        <div className="text-xs text-gray-400 mt-1">
          {prev.label}:{' '}
          {meta.kind === 'rate'
            ? `${prev.row.numerator}/${prev.row.denominator}（${prev.row.value}%）`
            : `${prev.row.value} ${unit}`}
        </div>
      )}
    </Link>
  );
}
