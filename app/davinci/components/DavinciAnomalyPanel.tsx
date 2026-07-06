'use client';

/**
 * 達文西異常偵測結果面板 — 1:1 鏡射 QIP 指標詳情頁的 AnomalyPanel
 * （app/indicators/[code]/page.tsx 內的區域元件，無法 import → 依隔離原則複製）
 * 紅框卡片、可摺疊標題列、狀態色列、預覽 3 筆 + 展開全部。
 */

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, TrendingUp } from 'lucide-react';
import { STATUS_CONFIG } from '@/lib/constants';
import type { AnomalyResult } from '@/lib/types';

interface Props {
  anomalies: AnomalyResult[];
  isQuarterly?: boolean;
}

export function DavinciAnomalyPanel({ anomalies, isQuarterly = false }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const previewCount = 3;

  // 按年月降序排列（最新在最上面）
  const sorted = [...anomalies].sort((a, b) => {
    const ya = a.year ?? 0, yb = b.year ?? 0;
    if (ya !== yb) return yb - ya;
    return (b.month ?? 0) - (a.month ?? 0);
  });

  if (sorted.length === 0) return null;

  const hasMore = sorted.length > previewCount;
  const displayItems = expanded ? sorted : sorted.slice(0, previewCount);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-red-100 mb-6">
      {/* 標題列（可點擊摺疊） */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-4 hover:bg-red-50/50 transition-colors rounded-lg"
      >
        <h2 className="text-base font-bold text-red-800 flex items-center gap-2">
          <AlertTriangle size={18} />
          異常偵測結果
          <span className="text-sm font-normal text-red-500">({sorted.length} 項)</span>
        </h2>
        {collapsed ? <ChevronDown size={18} className="text-red-400" /> : <ChevronUp size={18} className="text-red-400" />}
      </button>

      {/* 內容區 */}
      {!collapsed && (
        <div className="px-4 pb-4">
          <div className="space-y-2">
            {displayItems.map((a, i) => {
              const statusConf = STATUS_CONFIG[a.severity];
              const periodLabel = a.year && a.month
                ? isQuarterly
                  ? `${a.year}年Q${Math.ceil(a.month / 3)}`
                  : `${a.year}年${a.month}月`
                : '';

              return (
                <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${statusConf.bgLight}`}>
                  <span className={statusConf.textColor}><TrendingUp size={14} /></span>
                  {periodLabel && (
                    <span className="text-xs text-gray-500 shrink-0 font-mono w-20">
                      {periodLabel}
                    </span>
                  )}
                  <span className={`text-xs font-medium ${statusConf.textColor} shrink-0`}>
                    管制圖{a.rule ? `・${a.rule}` : ''}
                  </span>
                  <span className="text-sm text-gray-700 flex-1">{a.message}</span>
                </div>
              );
            })}
          </div>

          {/* 展開/收合剩餘項目 */}
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 flex items-center gap-1 text-xs text-red-600 hover:text-red-800 font-medium transition-colors"
            >
              {expanded ? (
                <><ChevronUp size={14} /> 收合</>
              ) : (
                <><span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">+</span> 還有 {sorted.length - previewCount} 項</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
