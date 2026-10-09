'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { IndicatorData } from '@/lib/types';
import { loadAnalysis } from '@/lib/api';
import {
  buildMonthlyCardSlides,
  listApplicableLimitKeys,
  resolveAnchorMonth,
  type LimitsByKey,
} from '@/lib/export/buildMonthlyCards';
import { MonthlyCardSlide } from '@/components/export/MonthlyCardSlide';
import { ExportMonthlyCardsButton } from '@/components/export/ExportMonthlyCardsButton';

interface Props {
  allData: Record<string, IndicatorData[]>;
}

const BATCH_SIZE = 8;

export function MonthlyCompareTab({ allData }: Props) {
  const anchor = useMemo(() => resolveAnchorMonth(allData), [allData]);
  const targets = useMemo(() => listApplicableLimitKeys(allData), [allData]);

  const [limits, setLimits] = useState<LimitsByKey | null>(null);
  const [failedCount, setFailedCount] = useState(0);

  // 分頁開啟時才載入管制界限（分批並行；單一失敗記 null，不中斷）
  useEffect(() => {
    let cancelled = false;
    setLimits(null);
    setFailedCount(0);

    (async () => {
      const result: LimitsByKey = {};
      let failed = 0;
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const chunk = targets.slice(i, i + BATCH_SIZE);
        await Promise.all(
          chunk.map(async ({ campus, code, key }) => {
            try {
              const analysis = await loadAnalysis(code, campus);
              result[key] = analysis.controlChart;
            } catch (e) {
              console.warn(`Failed to load control limits for ${key}:`, e);
              result[key] = null;
              failed++;
            }
          }),
        );
        if (cancelled) return;
      }
      if (!cancelled) {
        setLimits(result);
        setFailedCount(failed);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targets]);

  const slides = useMemo(
    () => (anchor && limits ? buildMonthlyCardSlides(allData, limits, anchor) : []),
    [allData, limits, anchor],
  );

  if (!anchor) {
    return <p className="text-sm text-gray-500">尚無可用的實質月份資料。</p>;
  }

  const loading = limits === null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <ExportMonthlyCardsButton slides={slides} disabled={loading} />
        {loading && (
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" />
            計算管制界限…
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        本月錨點：{anchor.year} 年 {anchor.month} 月（三院區最新實質月）。
        紅框＝該月有管制圖（control chart）異常訊號；月變動與同儕比較不著色。
        灰帶＝管制圖 CL ± 3σ（無管制圖的計數型指標不畫灰帶）。去年差＝本月值 − 去年同月值。
        {failedCount > 0 && (
          <span className="text-amber-600 ml-1">
            （{failedCount} 項指標的管制界限載入失敗，該卡無灰帶。）
          </span>
        )}
      </p>

      {!loading && (
        <div className="space-y-4">
          {slides.map(s => (
            <div key={s.pageIndex} className="border border-gray-200 rounded-md shadow-sm overflow-hidden">
              <MonthlyCardSlide slide={s} style={{ width: '100%', height: 'auto' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
