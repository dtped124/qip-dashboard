'use client';

import { useState, useEffect } from 'react';
import { CalendarRange, Loader2, AlertCircle } from 'lucide-react';
import { CrossCampusTable } from '@/components/cross-campus/CrossCampusTable';
import { CrossCampusAITab } from '@/components/cross-campus/CrossCampusAITab';
import { MonthlyCompareTab } from '@/components/cross-campus/MonthlyCompareTab';
import { ExportScorecardButton } from '@/components/export/ExportScorecardButton';
import { loadDashboardFromAPI } from '@/lib/api';
import { isAIEnabled } from '@/lib/ai/apiKeyManager';
import { lastCompleteQuarter, previousQuarter } from '@/lib/aggregation';
import { resolveAnchorMonth } from '@/lib/export/buildMonthlyCards';
import type { IndicatorData, Campus } from '@/lib/types';

const ALL_CAMPUSES: Campus[] = ['竹北', '竹東', '新竹'];

type Tab = 'table' | 'ai' | 'monthly';

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

  // 最新實質月邏輯已抽至 lib/export/buildMonthlyCards.ts（與月度比較分頁共用）
  const latest = resolveAnchorMonth(allData);
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

        <button
          onClick={() => setActiveTab('monthly')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'monthly'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          月度比較
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

      {activeTab === 'monthly' && <MonthlyCompareTab allData={allData} />}

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
