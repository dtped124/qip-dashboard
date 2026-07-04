'use client';

import { useState, useEffect } from 'react';
import { CalendarRange, Loader2, AlertCircle } from 'lucide-react';
import { CrossCampusTable } from '@/components/cross-campus/CrossCampusTable';
import { CrossCampusAITab } from '@/components/cross-campus/CrossCampusAITab';
import { ExportScorecardButton } from '@/components/export/ExportScorecardButton';
import { loadDashboardFromAPI } from '@/lib/api';
import { isAIEnabled } from '@/lib/ai/apiKeyManager';
import { lastCompleteQuarter, previousQuarter } from '@/lib/aggregation';
import type { IndicatorData, Campus } from '@/lib/types';

const ALL_CAMPUSES: Campus[] = ['竹北', '竹東', '新竹'];

type Tab = 'table' | 'ai';

/**
 * 「最近完整季」資訊（含當季、上一季、各自的標籤與起訖月）
 * — 不直接用 latestMonth 判季，避免單月資料被當成下季數值
 */
function completeQuarterInfo(latestYear: number, latestMonth: number) {
  const cur = lastCompleteQuarter(latestYear, latestMonth);
  const prev = previousQuarter(cur.year, cur.quarter);
  return { cur, prev };
}

function quarterLabelOf(year: number, quarter: number, startMonth: number, endMonth: number): string {
  return `${year}年Q${quarter}（${startMonth}-${endMonth}月）`;
}

/**
 * 找出三院區內最近一個「有實質測量資料」的月份。
 *
 * 過去用 `ind.latestMonth`（後端 latest_period，依 value 不為 null 判定），
 * 但 HA08-01 / HA10-01 等指標的來源 Excel 用 =SUM(子分類)，子分類沒填時
 * 公式輸出 0 → parser 老老實實存 value=0 → latest_period 抓到未來月份。
 * 結果：5 月時季度分析錨點變成「115Q4 (10-12月)」。
 *
 * 改用 monthlyData 直接掃 numerator/denominator，跟「要素清單匯出」的
 * 月份錨點邏輯一致。
 */
function findLatestYearMonth(allData: Record<string, IndicatorData[]>): { year: number; month: number } | null {
  let latestYear = 0;
  let latestMonth = 0;
  ALL_CAMPUSES.forEach(campus => {
    (allData[campus] || []).forEach(ind => {
      ind.monthlyData?.forEach(dp => {
        const n = dp.numerator;
        const d = dp.denominator;
        // 真實有效的測量月份至少會有 n>0 或 d>0；formula-evaluated 0 一律排除
        if ((n != null && n > 0) || (d != null && d > 0)) {
          if (dp.year > latestYear || (dp.year === latestYear && dp.month > latestMonth)) {
            latestYear = dp.year;
            latestMonth = dp.month;
          }
        }
      });
    });
  });
  return latestYear > 0 ? { year: latestYear, month: latestMonth } : null;
}

export default function CrossCampusPage() {
  const [allData, setAllData] = useState<Record<string, IndicatorData[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('table');
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    setAiEnabled(isAIEnabled());
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all(ALL_CAMPUSES.map(campus => loadDashboardFromAPI(campus)))
      .then(results => {
        const dataMap: Record<string, IndicatorData[]> = {};
        ALL_CAMPUSES.forEach((campus, i) => { dataMap[campus] = results[i]; });
        setAllData(dataMap);
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 size={40} className="text-blue-400 animate-spin" />
        <p className="text-sm text-gray-500">載入三院區資料中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
        <AlertCircle size={40} className="text-red-400" />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const latest = findLatestYearMonth(allData);
  const qInfo = latest ? completeQuarterInfo(latest.year, latest.month) : null;
  const currentQuarterLabel = qInfo
    ? quarterLabelOf(qInfo.cur.year, qInfo.cur.quarter, qInfo.cur.startMonth, qInfo.cur.endMonth)
    : '—';
  const prevLabel = qInfo
    ? quarterLabelOf(qInfo.prev.year, qInfo.prev.quarter, qInfo.prev.startMonth, qInfo.prev.endMonth)
    : '—';
  const qKey = qInfo ? `${qInfo.cur.year}Q${qInfo.cur.quarter}` : 'unknown';

  return (
    <div className="p-6 max-w-6xl">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-100 rounded-lg">
          <CalendarRange size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">季度分析</h1>
          <p className="text-sm text-gray-400">{currentQuarterLabel} · 三院區橫向比較</p>
        </div>
      </div>

      {/* Tab switcher + export button */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('table')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'table'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          統整表
        </button>

        {/* AI tab — always shown, disabled if AI not enabled */}
        <button
          onClick={() => {
            if (aiEnabled) setActiveTab('ai');
          }}
          title={!aiEnabled ? '請先至「設定 › AI 深度分析」開啟 AI 分析功能' : undefined}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'ai' && aiEnabled
              ? 'border-purple-600 text-purple-700'
              : !aiEnabled
              ? 'border-transparent text-gray-300 cursor-not-allowed'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          AI 分析
          {!aiEnabled && (
            <span className="ml-1 text-xs text-gray-300">（未啟用）</span>
          )}
        </button>

        <ExportScorecardButton allData={allData} />
      </div>

      {/* Tab content */}
      {activeTab === 'table' && (
        <CrossCampusTable
          allData={allData}
          quarterLabel={currentQuarterLabel}
          prevQuarterLabel={prevLabel}
        />
      )}

      {activeTab === 'ai' && aiEnabled && (
        <CrossCampusAITab
          allData={allData}
          quarterLabel={currentQuarterLabel}
          prevQuarterLabel={prevLabel}
          quarterKey={qKey}
        />
      )}
    </div>
  );
}
