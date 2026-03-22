'use client';

import { YearlySummary, IndicatorUnit, Campus } from '@/lib/types';
import { formatValue } from '@/lib/constants';

interface Props {
  latestValue: number | null;
  yearlySummaries: YearlySummary[];
  unit: IndicatorUnit;
  peerValue?: number | null;
  peerYear?: number | null;
  campus?: Campus;
}

/** 依院區取得 TCPI 同儕標竿標籤 */
function getPeerLabel(campus?: Campus): string {
  switch (campus) {
    case '新竹': return 'TCPI 醫學中心';
    case '竹北': return 'TCPI 區域醫院';
    case '竹東': return 'TCPI 地區醫院';
    default:     return 'TCPI 同儕標竿';
  }
}

export function BenchmarkBar({ latestValue, yearlySummaries, unit, peerValue, peerYear, campus }: Props) {
  // 找最新有標竿值的年度（含年份）
  let regional: number | null = null;
  let regionalYear: number | null = null;
  let district: number | null = null;
  let districtYear: number | null = null;
  for (let i = yearlySummaries.length - 1; i >= 0; i--) {
    const s = yearlySummaries[i];
    if (regional === null && s.benchmarkRegional !== null) {
      regional = s.benchmarkRegional;
      regionalYear = s.year;
    }
    if (district === null && s.benchmarkDistrict !== null) {
      district = s.benchmarkDistrict;
      districtYear = s.year;
    }
    if (regional !== null && district !== null) break;
  }

  // 組合比較項目
  const items: { label: string; value: number; color: string }[] = [];

  // 1. 本院最新值
  if (latestValue !== null) {
    items.push({ label: '本院最新值', value: latestValue, color: '#3B82F6' });
  }

  // 2. TCPI 同儕標竿（優先顯示）
  if (peerValue !== null && peerValue !== undefined) {
    const yearSuffix = peerYear ? ` (${peerYear}年)` : '';
    items.push({ label: `${getPeerLabel(campus)}${yearSuffix}`, value: peerValue, color: '#EF4444' });
  }

  // 3. QIP 區域/地區醫院標竿（來自前一年度全國統計）
  if (regional !== null) {
    items.push({
      label: `QIP 區域醫院${regionalYear ? ` (${regionalYear - 1}年)` : ''}`,
      value: regional,
      color: '#F97316',
    });
  }
  if (district !== null) {
    items.push({
      label: `QIP 地區醫院${districtYear ? ` (${districtYear - 1}年)` : ''}`,
      value: district,
      color: '#10B981',
    });
  }

  if (items.length === 0) {
    return <div className="text-sm text-gray-400 text-center py-8">無標竿比較資料</div>;
  }

  const maxVal = Math.max(...items.map(i => i.value));

  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="w-40 text-xs text-gray-500 text-right flex-shrink-0">{item.label}</div>
          <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${maxVal > 0 ? (item.value / maxVal) * 100 : 0}%`,
                backgroundColor: item.color,
              }}
            />
          </div>
          <div className="w-20 text-sm font-medium text-right">
            {formatValue(item.value, unit)}
          </div>
        </div>
      ))}
    </div>
  );
}
