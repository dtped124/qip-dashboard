'use client';

/**
 * 達文西指標詳情頁 — 版型 1:1 鏡射 QIP 指標詳情頁（app/indicators/[code]/page.tsx）：
 *   指標資訊卡（面向+代碼+越低越好+月/季+燈號 / 四格關鍵值）
 *   → 異常偵測結果（可摺疊） → 管制圖（含 匯出 PPTX）
 *   → 多年疊合趨勢 + 年度平均值比較 → 下鑽分析（達文西特有）
 *   → 完整數據 → AI 深度分析
 *
 * 透過 lib/qipAdapter 直接複用 QIP 的 ControlChart / YearOverlayChart /
 * YearCompareBar / DataTable / ExportSlideButton / AIAnalysisPanel
 * （僅 import，未修改 QIP 原始檔）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calendar, CalendarDays } from 'lucide-react';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TrendArrow } from '@/components/dashboard/TrendArrow';
import { ControlChart } from '@/components/charts/ControlChart';
import { YearOverlayChart } from '@/components/charts/YearOverlayChart';
import { YearCompareBar } from '@/components/charts/YearCompareBar';
import { DataTable } from '@/components/detail/DataTable';
import { ExportSlideButton } from '@/components/export/ExportSlideButton';
import { AIAnalysisPanel } from '@/components/ai/AIAnalysisPanel';
import type { PromptInput } from '@/lib/ai/promptBuilder';
import type { Campus } from '@/lib/types';
import { fetchDavinciSeries } from '../lib/api';
import type { DavinciMode, DavinciScope, DavinciSeries } from '../lib/types';
import { useDavinciStore } from '../lib/store';
import { DAVINCI_COLOR, unitLabel } from '../lib/ui';
import {
  toAnomalies,
  toControlChartParams,
  toMonthlyDataPoints,
  toQipMeta,
  toYearlySummaries,
} from '../lib/qipAdapter';
import { DavinciAnomalyPanel } from '../components/DavinciAnomalyPanel';
import { DrilldownPanel } from '../components/DrilldownPanel';

export default function DavinciDetailPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code || '').toUpperCase();

  const campus = useDavinciStore(s => s.campus);
  const mode = useDavinciStore(s => s.mode);
  const setMode = useDavinciStore(s => s.setMode);
  const dataVersion = useDavinciStore(s => s.dataVersion);

  const [series, setSeries] = useState<DavinciSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSeries(await fetchDavinciSeries(code, campus, mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, campus, mode, dataVersion]);

  useEffect(() => { load(); }, [load]);

  // ── 下鑽範圍 → 只影響「完整數據」表格（管制圖/年度比較維持全院區）──
  const [scope, setScope] = useState<DavinciScope>({});
  const [scopedSeries, setScopedSeries] = useState<DavinciSeries | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const scopeCache = useRef(new Map<string, DavinciSeries>());
  const scopeReqId = useRef(0);

  // DrilldownPanel 每次 crumb 變動都會呼叫 → 必須穩定，否則 panel 內的 effect 會空轉
  const handleScopeChange = useCallback((s: DavinciScope) => setScope(s), []);

  const scopeDept = scope.dept;
  const scopeSurgeon = scope.surgeon;
  const isScoped = Boolean(scopeDept || scopeSurgeon);

  // 切換指標/院區/月季/重新匯入 → 範圍與快取歸零
  useEffect(() => {
    scopeCache.current.clear();
    setScope({});
    setScopedSeries(null);
    setScopeError(null);
  }, [code, campus, mode, dataVersion]);

  useEffect(() => {
    if (!scopeDept && !scopeSurgeon) {
      setScopedSeries(null);
      setScopeError(null);
      return;
    }
    const key = `${code}|${campus}|${mode}|${dataVersion}|${scopeDept ?? ''}|${scopeSurgeon ?? ''}`;
    const hit = scopeCache.current.get(key);
    if (hit) {
      setScopedSeries(hit);
      setScopeError(null);
      return;
    }
    // 連點不同科別時回應可能亂序 → 只採用最後一次請求的結果
    const reqId = ++scopeReqId.current;
    setScopeLoading(true);
    setScopeError(null);
    fetchDavinciSeries(code, campus, mode, { dept: scopeDept, surgeon: scopeSurgeon })
      .then(r => {
        if (reqId !== scopeReqId.current) return;
        scopeCache.current.set(key, r);
        setScopedSeries(r);
      })
      .catch(e => {
        if (reqId !== scopeReqId.current) return;
        // 不退回全院區資料：標籤寫著科別卻顯示全院區數字是最糟的誤讀
        setScopedSeries(null);
        setScopeError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (reqId === scopeReqId.current) setScopeLoading(false);
      });
  }, [code, campus, mode, dataVersion, scopeDept, scopeSurgeon]);

  const isQuarterly = mode === 'quarterly';

  // ── QIP 型別轉接（元件直接複用） ──
  const adapted = useMemo(() => {
    if (!series) return null;
    return {
      meta: toQipMeta(series),
      monthlyData: toMonthlyDataPoints(series.points),
      controlChart: toControlChartParams(series),
      anomalies: toAnomalies(series),
      yearlySummaries: toYearlySummaries(series.points),
    };
  }, [series]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">載入指標詳情中...</div>
      </div>
    );
  }

  if (error || !series || !adapted) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error ?? `找不到指標 ${code}`}</p>
        <Link href="/davinci" className="text-blue-600 hover:underline text-sm">返回總覽</Link>
      </div>
    );
  }

  const { meta, monthlyData, controlChart, anomalies, yearlySummaries } = adapted;
  const unit = unitLabel(series.unit);

  // 只有「完整數據」吃篩選後的資料；monthlyData 維持全院區供其餘元件使用。
  // scoped 時 controlChart 傳 null —— 它對 DataTable 的唯一用途是回推分子分母，
  // 而回推來源必然是全院區的 n。
  const tableMonthlyData = isScoped && scopedSeries
    ? toMonthlyDataPoints(scopedSeries.points)
    : monthlyData;
  const tableControlChart = isScoped ? null : controlChart;
  const scopeLabel = [scopeDept, scopeSurgeon].filter(Boolean).join(' › ');

  // 最新值（沿 QIP 邏輯：最新有值期別）
  const validPoints = series.points.filter(p => p.value !== null);
  const latest = validPoints[validPoints.length - 1] ?? null;
  const latestMonthLabel = latest?.label ?? null;

  // 趨勢（本期 vs 上期；越低越好 → isReverse=true 時上升為紅）
  const prev = validPoints[validPoints.length - 2] ?? null;
  const trend: 'up' | 'down' | 'flat' =
    latest?.value != null && prev?.value != null
      ? latest.value > prev.value ? 'up' : latest.value < prev.value ? 'down' : 'flat'
      : 'flat';

  const unfavorable = anomalies.filter(a => a.direction === 'unfavorable');

  return (
    <div className="max-w-6xl mx-auto">
      {/* 返回按鈕 */}
      <Link href="/davinci" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={16} /> 返回總覽
      </Link>

      {/* 指標資訊卡（鏡射 QIP） */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: DAVINCI_COLOR }} />
              <span className="text-sm text-gray-500">達文西手術品質</span>
              <span className="font-mono text-sm text-gray-400">{code}</span>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">越低越好 ↓</span>
              {/* 月/季切換（鏡射 QIP PeriodToggle 樣式，接達文西 store） */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                {([['monthly', '月', Calendar], ['quarterly', '季', CalendarDays]] as const).map(([m, label, Icon]) => (
                  <button
                    key={m}
                    onClick={() => { if (m !== mode) setMode(m as DavinciMode); }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-sm transition-colors ${
                      mode === m
                        ? 'bg-white shadow-sm text-gray-800 font-medium'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{series.name}</h1>
          </div>
          <StatusBadge status={series.spc.rating} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">最新值</div>
            <div className="text-xl font-bold">
              {latest
                ? series.kind === 'rate'
                  ? <>{latest.numerator}/{latest.denominator}<span className="text-sm font-normal text-gray-500 ml-1.5">{latest.value}%</span></>
                  : <>{latest.value}<span className="text-sm font-normal text-gray-500 ml-1">{unit}</span></>
                : '—'}
            </div>
            {latestMonthLabel && <div className="text-xs text-gray-400">{latestMonthLabel}</div>}
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">標竿</div>
            <div className="text-xl font-bold text-gray-400">—</div>
            <div className="text-xs text-gray-400">待標竿管理設定</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">趨勢</div>
            <div className="mt-1"><TrendArrow trend={trend} isReverse={false} /></div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">異常偵測</div>
            {unfavorable.length > 0 ? (
              <div className="text-lg font-bold text-red-600">{unfavorable.length} 項</div>
            ) : (
              <div className="text-lg font-bold text-green-600">正常</div>
            )}
          </div>
        </div>
      </div>

      {/* 異常事件摘要（鏡射 QIP 可摺疊面板） */}
      <DavinciAnomalyPanel anomalies={unfavorable} isQuarterly={isQuarterly} />

      {/* 管制圖（直接複用 QIP ControlChart + PPTX 匯出） */}
      {controlChart ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              管制圖
              <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {controlChart.chartType === 'P' ? 'P Chart' : 'I-MR Chart'}
              </span>
              {series.spc.baseline_warning && (
                <span className="text-xs font-normal text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                  基線 {series.spc.baseline_n} 點 &lt; 24，僅供參考
                </span>
              )}
            </h2>
            <ExportSlideButton
              meta={meta}
              dataPoints={monthlyData}
              controlChart={controlChart}
              anomalies={anomalies}
              peerValue={null}
              campus={campus as Campus}
              isQuarterly={isQuarterly}
            />
          </div>
          <ControlChart
            dataPoints={monthlyData}
            controlChart={controlChart}
            anomalies={anomalies}
            direction="lower"
            unit={meta.unit}
            peerValue={null}
            isQuarterly={isQuarterly}
          />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-base font-bold text-gray-800 mb-2">管制圖</h2>
          <p className="text-sm text-amber-600">
            資料不足（{series.spc.baseline_n} 期 &lt; 6）：累積至 6 期後自動繪製管制圖與 WER 偵測。
          </p>
        </div>
      )}

      {/* 圖表區（鏡射 QIP：多年疊合 + 年度比較） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-bold text-gray-800 mb-4">多年疊合趨勢</h2>
          <YearOverlayChart
            monthlyData={monthlyData}
            yearlySummaries={yearlySummaries}
            unit={meta.unit}
            benchmarkValue={null}
            isQuarterly={isQuarterly}
          />
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-bold text-gray-800 mb-4">年度平均值比較</h2>
          <YearCompareBar yearlySummaries={yearlySummaries} unit={meta.unit} />
        </div>
      </div>

      {/* 下鑽分析（達文西特有：科別 → 醫師 → 術式 → 個案明細） */}
      {latest && (
        <div className="mb-6">
          <DrilldownPanel
            code={code}
            kind={series.kind}
            unit={series.unit}
            campus={campus}
            period={latest.period}
            periodLabel={latest.label}
            onScopeChange={handleScopeChange}
          />
        </div>
      )}

      {/* 完整數據表（直接複用 QIP DataTable） */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            完整數據
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
              isScoped ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {isScoped ? scopeLabel : '全院區'}
            </span>
            {scopeLoading && <span className="text-xs text-gray-400">載入中…</span>}
          </h2>
          {isScoped && (
            <span className="text-xs text-gray-400">
              以上方下鑽分析的麵包屑「全院區」可清除篩選
            </span>
          )}
        </div>
        {scopeError ? (
          <p className="text-sm text-red-600 py-6 text-center">
            此範圍載入失敗：{scopeError}
          </p>
        ) : isScoped && scopedSeries && scopedSeries.points.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">
            {scopeLabel} 在所有期別皆無資料
          </p>
        ) : (
          <DataTable
            monthlyData={tableMonthlyData}
            unit={meta.unit}
            isQuarterly={isQuarterly}
            controlChart={tableControlChart}
          />
        )}
        {isScoped && (
          <p className="text-xs text-gray-400 mt-3">
            上方管制圖與年度平均值比較固定為全院區——科別／醫師層每月人次過少，
            管制限會失去統計意義。
          </p>
        )}
      </div>

      {/* AI 深度分析（直接複用 QIP AIAnalysisPanel；僅送聚合統計，無個案資料） */}
      <AIAnalysisPanel
        promptInput={{
          meta,
          campus: campus as Campus,
          latestValue: latest?.value ?? null,
          latestMonth: latestMonthLabel,
          status: series.spc.rating,
          trend,
          peerValue: null,
          peerYear: null,
          benchmarkValue: null,
          controlChart,
          anomalies,
          monthlyData,
          yearlySummaries,
        } satisfies PromptInput}
        cacheKey={`davinci_${code}_${campus}_${latestMonthLabel ?? 'nodate'}`}
      />
    </div>
  );
}
