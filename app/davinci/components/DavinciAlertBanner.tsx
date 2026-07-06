'use client';

/**
 * 達文西警示橫幅 — 版型 1:1 鏡射 QIP 的 components/layout/AlertBanner：
 * 紅底橫幅、狀態圖示、mono 代碼、規則 tags、訊息、展開/收合、可關閉。
 */

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { DavinciIndicatorMeta, DavinciIndicatorRow } from '../lib/types';
import { WER_RULE_LABELS } from '../lib/ui';

interface Props {
  rows: DavinciIndicatorRow[];          // 當期各指標列（含 rating/signals）
  metas: DavinciIndicatorMeta[];
  campus: string;
  periodLabel: string;
}

export function DavinciAlertBanner({ rows, metas, campus, periodLabel }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const alertItems = rows.filter(r => r.rating === 'alert' || r.rating === 'warning' || r.rating === 'watch');

  if (alertItems.length === 0 || dismissed) return null;

  const alerts = alertItems.filter(r => r.rating === 'alert');
  const warnings = alertItems.filter(r => r.rating === 'warning');
  const watches = alertItems.filter(r => r.rating === 'watch');

  const previewCount = 3;
  const hasMore = alertItems.length > previewCount;
  const displayItems = expanded ? alertItems : alertItems.slice(0, previewCount);

  const statusIcon = (rating: string) => {
    if (rating === 'alert') return <AlertCircle size={14} className="text-red-600 shrink-0" />;
    if (rating === 'warning') return <span className="inline-block w-3 h-3 rounded-full bg-orange-500 shrink-0" />;
    return <span className="inline-block w-3 h-3 rounded-full bg-yellow-400 shrink-0" />;
  };

  return (
    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <AlertTriangle size={20} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-medium text-red-800">
              {periodLabel} {alertItems.length} 項注意
              <span className="font-normal text-red-600 text-sm ml-2">
                {[
                  alerts.length > 0 && `${alerts.length} 警示`,
                  warnings.length > 0 && `${warnings.length} 注意`,
                  watches.length > 0 && `${watches.length} 留意`,
                ].filter(Boolean).join('、')}
              </span>
            </h3>

            <div className="mt-1 text-sm text-red-700 space-y-1">
              {displayItems.map(item => {
                const meta = metas.find(m => m.code === item.code);
                const rules = Array.from(new Set(item.signals.map(s => WER_RULE_LABELS[s.rule] ?? s.rule)));
                const message = item.signals[0]?.message ?? '';
                return (
                  <Link
                    key={item.code}
                    href={`/davinci/${item.code}`}
                    className="flex items-center gap-2 hover:text-red-900 hover:bg-red-100 rounded px-1 -mx-1 py-0.5 transition-colors"
                  >
                    {statusIcon(item.rating)}
                    <span className="font-mono text-xs text-red-500">{item.code}</span>
                    <span>{meta?.name}</span>
                    {rules.length > 0 && (
                      <span className="text-[10px] text-red-500 border border-red-300 bg-white px-1.5 py-0.5 rounded">
                        {rules.join('・')}
                      </span>
                    )}
                    {message && (
                      <span className="text-xs text-red-400 truncate max-w-[200px]">— {message}</span>
                    )}
                    <span className="text-xs text-red-400 shrink-0">({campus})</span>
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
