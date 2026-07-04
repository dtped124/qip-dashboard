'use client';

/**
 * 達文西指標卡（Phase 1）
 * - 比率型：大字 n/分母 + 百分比（0 事件顯示 0/15 而非 0%）
 * - 連續型：月平均 + 中位數並列
 * - 迷你趨勢：跨期別 value 序列（inline SVG，Phase 2 換 SPC 圖）
 * - 月增減：與上一期比較（七項皆越低越好 → 上升為不利紅色）
 */

import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { DavinciIndicatorMeta, DavinciPeriodGroup } from '../lib/types';

interface Props {
  meta: DavinciIndicatorMeta;
  groups: DavinciPeriodGroup[];      // 全期別（遞增）
  selectedPeriod: number;
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) {
    return <div className="h-8 text-[10px] text-gray-300 flex items-center">趨勢累積中</div>;
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const step = w / (values.length - 1);
  const pts = values
    .map((v, i) => (v === null ? null : `${i * step},${h - 4 - ((v - min) / range) * (h - 8)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg width={w} height={h} className="text-blue-500">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function IndicatorCard({ meta, groups, selectedPeriod }: Props) {
  const series = groups.map(g =>
    g.indicators.find(r => r.indicator_code === meta.code) ?? null,
  );
  const idx = groups.findIndex(g => g.period === selectedPeriod);
  const current = idx >= 0 ? series[idx] : null;
  const prev = idx > 0 ? series[idx - 1] : null;

  const unitLabel = meta.unit === 'percent' ? '%' : meta.unit === 'min' ? '分' : 'ml';

  // 月增減（越低越好：上升 = 不利）
  let trend: 'up' | 'down' | 'flat' | null = null;
  if (current?.value != null && prev?.value != null) {
    if (current.value > prev.value) trend = 'up';
    else if (current.value < prev.value) trend = 'down';
    else trend = 'flat';
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-gray-400">{meta.code}</div>
          <div className="text-sm font-medium text-gray-800 leading-tight">{meta.name}</div>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
          {meta.kind === 'rate' ? 'P/I-MR' : 'I-MR'}
        </span>
      </div>

      {current ? (
        meta.kind === 'rate' ? (
          <div className="flex items-baseline gap-2">
            {/* 0 事件顯示 0/15 而非 0% */}
            <span className="text-2xl font-bold text-gray-900">
              {current.numerator}
              <span className="text-gray-400 text-lg font-normal">/{current.denominator}</span>
            </span>
            <span className="text-sm text-gray-500">
              {current.value != null ? `${current.value}%` : '—'}
            </span>
            {trend === 'up' && <TrendingUp size={16} className="text-red-500" />}
            {trend === 'down' && <TrendingDown size={16} className="text-green-600" />}
            {trend === 'flat' && <Minus size={16} className="text-gray-400" />}
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">
              {current.value != null ? current.value : '—'}
              <span className="text-sm text-gray-400 font-normal ml-0.5">{unitLabel}</span>
            </span>
            <span className="text-xs text-gray-500">
              中位數 {current.median_value != null ? current.median_value : '—'}
            </span>
            {trend === 'up' && <TrendingUp size={16} className="text-red-500" />}
            {trend === 'down' && <TrendingDown size={16} className="text-green-600" />}
            {trend === 'flat' && <Minus size={16} className="text-gray-400" />}
            {current.n_excluded > 0 && (
              <span className="text-[10px] text-amber-600">排除 {current.n_excluded} 台</span>
            )}
          </div>
        )
      ) : (
        <div className="text-lg text-gray-300">本月無資料</div>
      )}

      <div className="flex items-end justify-between">
        <Sparkline values={series.map(r => r?.value ?? null)} />
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
          監測中
        </span>
      </div>
    </div>
  );
}
