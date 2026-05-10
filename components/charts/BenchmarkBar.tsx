'use client';

import { IndicatorUnit, Campus } from '@/lib/types';
import { formatValue } from '@/lib/constants';

interface Props {
  latestValue: number | null;
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

export function BenchmarkBar({ latestValue, unit, peerValue, peerYear, campus }: Props) {
  // 組合比較項目
  const items: { label: string; value: number; color: string }[] = [];

  // 1. 本院最新值
  if (latestValue !== null) {
    items.push({ label: '本院最新值', value: latestValue, color: '#3B82F6' });
  }

  // 2. TCPI 同儕標竿
  if (peerValue !== null && peerValue !== undefined) {
    const yearSuffix = peerYear ? ` (${peerYear}年)` : '';
    items.push({ label: `${getPeerLabel(campus)}${yearSuffix}`, value: peerValue, color: '#EF4444' });
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
