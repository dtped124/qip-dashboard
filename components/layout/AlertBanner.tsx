'use client';

import { IndicatorData } from '@/lib/types';
import { AlertTriangle, AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';

const MECHANISM_LABELS: Record<string, string> = {
  control_chart: '管制圖',
  monthly_change: '月增減',
  peer_comparison: '同儕比較',
};

function getLatestMechanisms(item: IndicatorData): string[] {
  const validPoints = item.monthlyData
    .filter(dp => dp.value !== null)
    .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
  const latest = validPoints[0];
  if (!latest) return [];

  const unfavorable = item.anomalies.filter(a =>
    a.direction === 'unfavorable' &&
    a.year === latest.year &&
    a.month === latest.month
  );
  const mechanisms = new Set(unfavorable.map(a => MECHANISM_LABELS[a.mechanism]).filter(Boolean));
  return Array.from(mechanisms);
}

interface Props {
  indicators: IndicatorData[];
}

export function AlertBanner({ indicators }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const alertItems = indicators.filter(i => i.status === 'alert' || i.status === 'warning' || i.status === 'watch');

  if (alertItems.length === 0 || dismissed) return null;

  const alerts = alertItems.filter(i => i.status === 'alert');
  const warnings = alertItems.filter(i => i.status === 'warning');
  const watches = alertItems.filter(i => i.status === 'watch');

  const previewCount = 3;
  const hasMore = alertItems.length > previewCount;
  const displayItems = expanded ? alertItems : alertItems.slice(0, previewCount);

  const statusIcon = (status: string) => {
    if (status === 'alert') return <AlertCircle size={14} className="text-red-600 shrink-0" />;
    if (status === 'warning') return <span className="inline-block w-3 h-3 rounded-full bg-orange-500 shrink-0" />;
    return <span className="inline-block w-3 h-3 rounded-full bg-yellow-400 shrink-0" />;
  };

  return (
    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <AlertTriangle size={20} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-medium text-red-800">
              {alertItems.length} 項注意
              <span className="font-normal text-red-600 text-sm ml-2">
                {[
                  alerts.length > 0 && `${alerts.length} 警示`,
                  warnings.length > 0 && `${warnings.length} 警告`,
                  watches.length > 0 && `${watches.length} 留意`,
                ].filter(Boolean).join('、')}
              </span>
            </h3>

            <div className="mt-1 text-sm text-red-700 space-y-1">
              {displayItems.map(item => {
                const mechanisms = getLatestMechanisms(item);
                return (
                  <Link
                    key={`${item.meta.code}_${item.campus}`}
                    href={`/indicators/${item.meta.code}`}
                    className="flex items-center gap-2 hover:text-red-900 hover:bg-red-100 rounded px-1 -mx-1 py-0.5 transition-colors"
                  >
                    {statusIcon(item.status)}
                    <span className="font-mono text-xs text-red-500">{item.meta.code}</span>
                    <span>{item.meta.name}</span>
                    {mechanisms.length > 0 && (
                      <span className="text-[10px] text-red-500 border border-red-300 bg-white px-1.5 py-0.5 rounded">
                        {mechanisms.join('・')}
                      </span>
                    )}
                    <span className="text-xs text-red-400">({item.campus})</span>
                  </Link>
                );
              })}
            </div>

            {hasMore && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-1.5 flex items-center gap-1 text-xs text-red-600 hover:text-red-800 font-medium transition-colors"
              >
                {expanded ? (
                  <><ChevronUp size={14} /> 收合</>
                ) : (
                  <><ChevronDown size={14} /> 顯示全部 {alertItems.length} 項</>
                )}
              </button>
            )}
          </div>
        </div>
        <button onClick={() => setDismissed(true)} className="text-red-400 hover:text-red-600 ml-2">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
