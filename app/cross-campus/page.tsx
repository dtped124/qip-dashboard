'use client';

import { useState, useEffect } from 'react';
import { CalendarRange, Loader2, AlertCircle } from 'lucide-react';
import { CrossCampusTable } from '@/components/cross-campus/CrossCampusTable';
import { CrossCampusAITab } from '@/components/cross-campus/CrossCampusAITab';
import { ExportScorecardButton } from '@/components/export/ExportScorecardButton';
import { loadDashboardFromAPI } from '@/lib/api';
import { isAIEnabled } from '@/lib/ai/apiKeyManager';
import type { IndicatorData, Campus } from '@/lib/types';

const ALL_CAMPUSES: Campus[] = ['竹北', '竹東', '新竹'];

type Tab = 'table' | 'ai';

function parseLatestMonth(s: string | null): { year: number; month: number } | null {
  if (!s) return null;
  const m1 = s.match(/^(\d+)\.(\d+)$/);
  if (m1) return { year: parseInt(m1[1]), month: parseInt(m1[2]) };
  const m2 = s.match(/^(\d+)年(\d+)月$/);
  if (m2) return { year: parseInt(m2[1]), month: parseInt(m2[2]) };
  return null;
}

function getQuarterNum(month: number): number {
  return Math.ceil(month / 3);
}

function quarterLabel(year: number, month: number): string {
  const q = getQuarterNum(month);
  const start = (q - 1) * 3 + 1;
  const end = q * 3;
  return `${year}年Q${q}（${start}-${end}月）`;
}

function prevQuarterLabel(year: number, month: number): string {
  const q = getQuarterNum(month);
  if (q === 1) return `${year - 1}年Q4（10-12月）`;
  const pq = q - 1;
  return `${year}年Q${pq}（${(pq - 1) * 3 + 1}-${pq * 3}月）`;
}

function quarterKey(year: number, month: number): string {
  return `${year}Q${getQuarterNum(month)}`;
}

function findLatestYearMonth(allData: Record<string, IndicatorData[]>): { year: number; month: number } | null {
  let latestYear = 0;
  let latestMonth = 0;
  ALL_CAMPUSES.forEach(campus => {
    (allData[campus] || []).forEach(ind => {
      if (ind.latestMonth) {
        const parsed = parseLatestMonth(ind.latestMonth);
        if (parsed) {
          if (parsed.year > latestYear || (parsed.year === latestYear && parsed.month > latestMonth)) {
            latestYear = parsed.year;
            latestMonth = parsed.month;
          }
        }
      }
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
  const currentQuarterLabel = latest ? quarterLabel(latest.year, latest.month) : '—';
  const prevLabel = latest ? prevQuarterLabel(latest.year, latest.month) : '—';
  const qKey = latest ? quarterKey(latest.year, latest.month) : 'unknown';

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
