'use client';

import { useState } from 'react';
import { Bot, RefreshCw, AlertTriangle } from 'lucide-react';
import { CampusAIPanel, type PanelStatus } from './CampusAIPanel';
import { CommonIssuesPanel } from './CommonIssuesPanel';
import { analyzeCampus, analyzeCommonIssues } from '@/lib/ai/crossCampusClient';
import { AIAnalysisError } from '@/lib/ai/claudeClient';
import { isAIEnabled, hasApiKey } from '@/lib/ai/apiKeyManager';
import type { IndicatorData, Campus, IndicatorStatus } from '@/lib/types';
import type { ParsedCampusAnalysis, ParsedCommonIssues, CrossCampusIndicatorInput } from '@/lib/ai/promptBuilder';
import Link from 'next/link';

const ALL_CAMPUSES: Campus[] = ['竹北', '竹東', '新竹'];
const ANOMALOUS_STATUSES = ['alert', 'warning', 'watch'] as const;
function isAnomalous(s: IndicatorStatus): boolean { return (ANOMALOUS_STATUSES as readonly string[]).includes(s); }

type OverallState = 'idle' | 'confirming' | 'running' | 'done';

interface CampusPanelState {
  status: PanelStatus;
  result: ParsedCampusAnalysis | null;
  rawText?: string;
  error?: string;
}

interface CommonState {
  status: PanelStatus;
  result: ParsedCommonIssues | null;
  rawText?: string;
  error?: string;
}

function parseLatestMonth(s: string | null): { year: number; month: number } | null {
  if (!s) return null;
  const m1 = s.match(/^(\d+)\.(\d+)$/);
  if (m1) return { year: parseInt(m1[1]), month: parseInt(m1[2]) };
  const m2 = s.match(/^(\d+)年(\d+)月$/);
  if (m2) return { year: parseInt(m2[1]), month: parseInt(m2[2]) };
  return null;
}

function quarterRange(year: number, month: number): {
  curYear: number; curStart: number;
  prevYear: number; prevStart: number;
} {
  const q = Math.ceil(month / 3);
  const curStart = (q - 1) * 3 + 1;
  const prevQ = q - 1;
  if (prevQ === 0) return { curYear: year, curStart, prevYear: year - 1, prevStart: 10 };
  return { curYear: year, curStart, prevYear: year, prevStart: (prevQ - 1) * 3 + 1 };
}

function quarterAverage(
  monthlyData: { year: number; month: number; value: number | null }[],
  year: number,
  startMonth: number,
  upToMonth?: number
): number | null {
  const endMonth = Math.min(startMonth + 2, upToMonth ?? startMonth + 2);
  const vals: number[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    const dp = monthlyData.find(d => d.year === year && d.month === m);
    if (dp && dp.value !== null) vals.push(dp.value);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function buildCampusInput(
  campus: Campus,
  indicators: IndicatorData[],
  quarter: string,
  prevQuarter: string,
  allCampusData: Record<string, IndicatorData[]>,
): import('@/lib/ai/promptBuilder').CampusAnalysisInput {
  // Determine which codes are unique to this campus
  const thisCodesSet = new Set(indicators.map(i => i.meta.code));
  const otherCampusCodes = new Set<string>();
  ALL_CAMPUSES.filter(c => c !== campus).forEach(c => {
    (allCampusData[c] || []).forEach(i => otherCampusCodes.add(i.meta.code));
  });

  const anomalousIndicators: CrossCampusIndicatorInput[] = indicators
    .filter(ind => isAnomalous(ind.status))
    .map(ind => {
      const parsed = parseLatestMonth(ind.latestMonth);
      let curr: number | null = ind.latestValue;
      let prevValue: number | null = null;
      if (parsed) {
        const { curYear, curStart, prevYear, prevStart } = quarterRange(parsed.year, parsed.month);
        curr      = quarterAverage(ind.monthlyData, curYear,  curStart, parsed.month);
        prevValue = quarterAverage(ind.monthlyData, prevYear, prevStart);
      }

      let changeArrow: '↑' | '↓' | '→' = '→';
      if (curr !== null && prevValue !== null && prevValue !== 0) {
        const diff = (curr - prevValue) / Math.abs(prevValue);
        if (Math.abs(diff) >= 0.01) changeArrow = curr > prevValue ? '↑' : '↓';
      }

      return {
        code: ind.meta.code,
        name: ind.meta.name,
        category: ind.meta.category,
        direction: ind.meta.direction,
        currentValue: curr,
        prevQuarterValue: prevValue,
        changeArrow,
        status: ind.status,
        isUniqueToThisCampus: thisCodesSet.has(ind.meta.code) && !otherCampusCodes.has(ind.meta.code),
        anomalyMessages: ind.anomalies
          .filter(a => a.direction === 'unfavorable')
          .slice(0, 2)
          .map(a => a.message),
      };
    });

  return { campus, quarter, prevQuarter, anomalousIndicators };
}

interface Props {
  allData: Record<string, IndicatorData[]>;
  quarterLabel: string;
  prevQuarterLabel: string;
  quarterKey: string; // e.g. "115Q1"
  forceRefresh?: boolean;
}

export function CrossCampusAITab({ allData, quarterLabel, prevQuarterLabel, quarterKey, forceRefresh }: Props) {
  const [overallState, setOverallState] = useState<OverallState>('idle');
  const [campusStates, setCampusStates] = useState<Record<string, CampusPanelState>>({
    竹北: { status: 'pending', result: null },
    竹東: { status: 'pending', result: null },
    新竹: { status: 'pending', result: null },
  });
  const [commonState, setCommonState] = useState<CommonState>({ status: 'pending', result: null });

  const aiEnabled = isAIEnabled();
  const apiKeySet = typeof window !== 'undefined' ? hasApiKey() : false;

  // AI disabled or no API key
  if (!aiEnabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="p-3 bg-gray-100 rounded-full">
          <Bot size={24} className="text-gray-400" />
        </div>
        <p className="text-sm text-gray-500">AI 分析功能尚未啟用</p>
        <Link
          href="/settings/ai"
          className="text-xs text-purple-600 hover:underline"
        >
          前往「設定 › AI 深度分析」開啟功能
        </Link>
      </div>
    );
  }

  if (!apiKeySet) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="p-3 bg-gray-100 rounded-full">
          <Bot size={24} className="text-gray-400" />
        </div>
        <p className="text-sm text-gray-500">尚未設定 Claude API Key</p>
        <Link
          href="/settings/ai"
          className="text-xs text-purple-600 hover:underline"
        >
          前往「設定 › AI 深度分析」設定 API Key
        </Link>
      </div>
    );
  }

  async function handleStartAnalysis(skipLimitCheck = false) {
    setOverallState('running');
    // Reset states
    setCampusStates({
      竹北: { status: 'loading', result: null },
      竹東: { status: 'loading', result: null },
      新竹: { status: 'loading', result: null },
    });
    setCommonState({ status: 'pending', result: null });

    // Build inputs for all 3 campuses
    const campusInputs = ALL_CAMPUSES.map(campus => ({
      campus,
      input: buildCampusInput(campus, allData[campus] || [], quarterLabel, prevQuarterLabel, allData),
      cacheKey: `cross_campus_${campus}_${quarterKey}`,
    }));

    // Run 3 campus analyses in parallel
    const campusResults = await Promise.allSettled(
      campusInputs.map(({ campus, input, cacheKey }) =>
        analyzeCampus(input, cacheKey, { skipLimitCheck, forceRefresh }).then(res => ({ campus, res }))
      )
    );

    const successResults: { campus: string; summary: string; topConcerns: string[] }[] = [];
    const newCampusStates: Record<string, CampusPanelState> = {};

    campusResults.forEach((settled, idx) => {
      const campus = ALL_CAMPUSES[idx];
      if (settled.status === 'fulfilled') {
        const { res } = settled.value;
        newCampusStates[campus] = { status: 'done', result: res.parsed, rawText: res.rawText };
        if (res.parsed) {
          successResults.push({
            campus,
            summary: res.parsed.campus_summary,
            topConcerns: res.parsed.key_concerns.slice(0, 3).map(c => c.concern),
          });
        }
      } else {
        const err = settled.reason as AIAnalysisError | Error;
        newCampusStates[campus] = { status: 'error', result: null, error: err.message };
      }
    });

    setCampusStates(newCampusStates);

    // Only run common issues if at least 2 campuses succeeded
    if (successResults.length < 2) {
      setCommonState({ status: 'error', result: null, error: '需要至少 2 個院區的分析結果才能進行共通問題分析。' });
      setOverallState('done');
      return;
    }

    setCommonState(prev => ({ ...prev, status: 'loading' }));

    // Build shared codes (anomalous in all successful campuses)
    const allCodes = new Map<string, string>();
    successResults.forEach(r => {
      const campusData = allData[r.campus] || [];
      campusData
        .filter(i => isAnomalous(i.status))
        .forEach(i => allCodes.set(i.meta.code, i.meta.name));
    });

    // Codes that are anomalous in ALL successful campuses
    const sharedCodes: { code: string; name: string }[] = [];
    allCodes.forEach((name, code) => {
      const inAll = successResults.every(r =>
        (allData[r.campus] || []).some(i => i.meta.code === code && isAnomalous(i.status))
      );
      if (inAll) sharedCodes.push({ code, name });
    });

    try {
      const commonResult = await analyzeCommonIssues(
        { quarter: quarterLabel, campusResults: successResults, sharedCodes },
        `cross_campus_common_${quarterKey}`,
        { skipLimitCheck, forceRefresh },
      );
      setCommonState({ status: 'done', result: commonResult.parsed, rawText: commonResult.rawText });
    } catch (err) {
      const e = err as Error;
      setCommonState({ status: 'error', result: null, error: e.message });
    }

    setOverallState('done');
  }

  // Confirm dialog
  if (overallState === 'confirming') {
    return (
      <div className="max-w-md mx-auto mt-8">
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={20} className="text-amber-500" />
            <h3 className="font-semibold text-gray-800">AI 分析費用提示</h3>
          </div>
          <p className="text-sm text-gray-600 mb-3">本次將進行 4 次 Claude API 呼叫：</p>
          <ul className="text-sm text-gray-600 space-y-1 mb-4 pl-4">
            {ALL_CAMPUSES.map(c => <li key={c} className="list-disc">• {c}院區分析</li>)}
            <li className="list-disc">• 跨院區共通問題分析</li>
          </ul>
          <p className="text-sm text-gray-500 mb-4">
            預估費用：約 NT$2–4（依資料量而定）<br />
            <span className="text-xs text-gray-400">快取有效期 30 天，相同季度資料不重複計費</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setOverallState('idle')}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={() => handleStartAnalysis(false)}
              className="flex-1 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              確認開始分析
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Idle state — show start button
  if (overallState === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="p-4 bg-purple-50 rounded-full">
          <Bot size={32} className="text-purple-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">跨院區 AI 季度分析</p>
          <p className="text-xs text-gray-400 mt-1">{quarterLabel} · 4 次 API 呼叫 · 約 NT$2–4</p>
        </div>
        <button
          onClick={() => setOverallState('confirming')}
          className="px-6 py-2.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 font-medium"
        >
          開始 AI 分析
        </button>
      </div>
    );
  }

  // Running or done
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{quarterLabel} 跨院區 AI 分析</p>
        {overallState === 'done' && (
          <button
            onClick={() => setOverallState('confirming')}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <RefreshCw size={12} /> 重新分析
          </button>
        )}
      </div>

      {ALL_CAMPUSES.map(campus => (
        <CampusAIPanel
          key={campus}
          campus={campus}
          status={campusStates[campus]?.status ?? 'pending'}
          result={campusStates[campus]?.result ?? null}
          rawText={campusStates[campus]?.rawText}
          error={campusStates[campus]?.error}
        />
      ))}

      <CommonIssuesPanel
        status={commonState.status}
        result={commonState.result}
        rawText={commonState.rawText}
        error={commonState.error}
      />
    </div>
  );
}
