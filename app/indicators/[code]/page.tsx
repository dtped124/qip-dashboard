'use client';

import { useDashboardStore } from '@/lib/store/dashboardStore';
import { useParams } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { CATEGORY_COLORS, STATUS_CONFIG, formatValue, INDICATOR_META } from '@/lib/constants';
import { loadIndicatorData, loadIndicatorSummaries, loadAnalysis } from '@/lib/api';
import type { MonthlyDataPoint, YearlySummary, ControlChartParams, AnomalyResult as AnomalyResultType, IndicatorStatus } from '@/lib/types';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TrendArrow } from '@/components/dashboard/TrendArrow';
import { ControlChart } from '@/components/charts/ControlChart';
import { YearOverlayChart } from '@/components/charts/YearOverlayChart';
import { YearCompareBar } from '@/components/charts/YearCompareBar';
import { BenchmarkBar } from '@/components/charts/BenchmarkBar';
import { DataTable } from '@/components/detail/DataTable';
import { PeriodToggle } from '@/components/dashboard/PeriodToggle';
import { aggregateToQuarterly } from '@/lib/aggregation';
import { ArrowLeft, AlertTriangle, TrendingUp, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { AIAnalysisPanel } from '@/components/ai/AIAnalysisPanel';
import type { PromptInput } from '@/lib/ai/promptBuilder';
import Link from 'next/link';

export default function IndicatorDetailPage() {
  const indicators = useDashboardStore(s => s.indicators);
  const campus = useDashboardStore(s => s.campus);
  const periodMode = useDashboardStore(s => s.periodMode);
  const params = useParams();
  const code = params.code as string;

  // Find basic indicator info from store (dashboard data)
  const storeIndicator = indicators.find(
    i => i.meta.code === code && i.campus === campus
  );

  // Load full detail data from API
  const [detailData, setDetailData] = useState<{
    monthlyData: MonthlyDataPoint[];
    summaries: YearlySummary[];
    analysis: { status: string; anomalies: AnomalyResultType[]; controlChart: ControlChartParams | null; peerValue: number | null } | null;
  } | null>(null);
  const [quarterlyAnalysis, setQuarterlyAnalysis] = useState<{
    status: string; anomalies: AnomalyResultType[]; controlChart: ControlChartParams | null; peerValue: number | null;
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);

  useEffect(() => {
    if (!code || !campus) return;
    setLoadingDetail(true);
    Promise.all([
      loadIndicatorData(code, campus),
      loadIndicatorSummaries(code, campus),
      loadAnalysis(code, campus),
    ])
      .then(([monthly, summaryResult, analysis]) => {
        setDetailData({
          monthlyData: monthly,
          summaries: summaryResult.summaries,
          analysis,
        });
      })
      .catch(err => {
        console.error('Failed to load detail:', err);
      })
      .finally(() => setLoadingDetail(false));
  }, [code, campus]);

  // 季度模式：額外載入季度分析（管制圖 + 異常偵測）
  useEffect(() => {
    if (!code || !campus || periodMode !== 'quarterly') {
      setQuarterlyAnalysis(null);
      return;
    }
    loadAnalysis(code, campus, 'quarterly')
      .then(setQuarterlyAnalysis)
      .catch(err => console.error('Failed to load quarterly analysis:', err));
  }, [code, campus, periodMode]);

  // Build indicator from API data or store
  const meta = storeIndicator?.meta || (() => {
    const m = INDICATOR_META[code];
    if (!m) return null;
    return { code, ...m, source: 'preset' as const, isActive: true, isReverse: m.direction === 'lower' };
  })();

  // 判斷是否使用季度檢視（原生季報指標不受切換影響）
  const isNativeQuarterly = meta?.isQuarterly ?? false;
  const useQuarterlyView = periodMode === 'quarterly' && !isNativeQuarterly;
  const effectiveIsQuarterly = isNativeQuarterly || useQuarterlyView;

  const rawMonthlyData = detailData?.monthlyData || storeIndicator?.monthlyData || [];
  const dataNature = meta?.dataNature ?? 'continuous';
  const unit = meta?.unit ?? 'percent';
  const monthlyData = useMemo(
    () => useQuarterlyView ? aggregateToQuarterly(rawMonthlyData, dataNature, unit) : rawMonthlyData,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawMonthlyData.length, useQuarterlyView, dataNature, unit],
  );

  if (!meta) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">找不到指標 {code}</p>
        <Link href="/" className="text-blue-600 hover:underline text-sm">返回首頁</Link>
      </div>
    );
  }

  if (loadingDetail) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">載入指標詳情中...</div>
      </div>
    );
  }

  const yearlySummaries = detailData?.summaries || storeIndicator?.yearlySummaries || [];

  // 季度模式使用季度分析結果，月度模式使用原始分析結果
  const activeAnalysis = useQuarterlyView && quarterlyAnalysis ? quarterlyAnalysis : detailData?.analysis;
  const controlChart = activeAnalysis?.controlChart || storeIndicator?.controlChart || null;
  const anomalies = activeAnalysis?.anomalies || storeIndicator?.anomalies || [];
  const status = (activeAnalysis?.status || storeIndicator?.status || 'neutral') as IndicatorStatus;
  const trend = storeIndicator?.trend || 'flat';
  const peerValue = activeAnalysis?.peerValue ?? storeIndicator?.peerValue ?? null;
  const peerYear = storeIndicator?.peerYear ?? null;
  const benchmarkValue = storeIndicator?.benchmarkValue ?? null;

  // Compute latest value from full monthly data
  const validMonthly = monthlyData.filter(d => d.value !== null).sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month);
  const latestValue = validMonthly[0]?.value ?? storeIndicator?.latestValue ?? null;
  const latestMonth = validMonthly[0] ? `${validMonthly[0].year}.${String(validMonthly[0].month).padStart(2, '0')}` : storeIndicator?.latestMonth ?? null;
  const color = CATEGORY_COLORS[meta.category];
  const directionLabel = meta.direction === 'lower' ? '越低越好 ↓' : meta.direction === 'higher' ? '越高越好 ↑' : '持續監測 →';

  // 標竿值優先使用 TCPI，其次使用 QIP Excel 標竿
  const primaryBenchmark = peerValue ?? benchmarkValue;
  const benchmarkLabel = peerValue !== null
    ? `TCPI 標竿${peerYear ? ` (${peerYear}年)` : ''}`
    : '標竿值';

  // 只看最新月份的不利異常
  const latestAnomalies = anomalies.filter(a => a.direction === 'unfavorable');
  const uniqueAnomalies = latestAnomalies.reduce((acc, a) => {
    const key = `${a.mechanism}_${a.year}_${a.month}`;
    if (!acc.has(key)) acc.set(key, a);
    return acc;
  }, new Map<string, typeof latestAnomalies[0]>());

  return (
    <div className="max-w-6xl mx-auto">
      {/* 返回按鈕 */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={16} /> 返回總覽
      </Link>

      {/* 指標資訊卡 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-sm text-gray-500">{meta.category}</span>
              <span className="font-mono text-sm text-gray-400">{meta.code}</span>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{directionLabel}</span>
              {!isNativeQuarterly && <PeriodToggle />}
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{meta.name}</h1>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">最新值</div>
            <div className="text-xl font-bold">{formatValue(latestValue, meta.unit)}</div>
            {latestMonth && <div className="text-xs text-gray-400">{latestMonth}</div>}
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">{benchmarkLabel}</div>
            <div className="text-xl font-bold">{formatValue(primaryBenchmark, meta.unit)}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">趨勢</div>
            <div className="mt-1"><TrendArrow trend={trend} isReverse={meta.isReverse} /></div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">異常偵測</div>
            {uniqueAnomalies.size > 0 ? (
              <div className="text-lg font-bold text-red-600">{uniqueAnomalies.size} 項</div>
            ) : (
              <div className="text-lg font-bold text-green-600">正常</div>
            )}
          </div>
        </div>
      </div>

      {/* 異常事件摘要 */}
      {uniqueAnomalies.size > 0 && (
        <AnomalyPanel anomalies={Array.from(uniqueAnomalies.values())} isQuarterly={effectiveIsQuarterly} />
      )}

      {/* 管制圖 */}
      {controlChart && (controlChart.sigma > 0 || (controlChart.variableLimits && controlChart.variableLimits.length > 0)) && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
            管制圖
            <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {controlChart.chartType === 'P' ? 'P Chart'
                : controlChart.chartType === 'U' ? 'U Chart'
                : 'I-MR Chart'}
            </span>
          </h2>
          <ControlChart
            dataPoints={monthlyData}
            controlChart={controlChart}
            anomalies={anomalies}
            direction={meta.direction}
            unit={meta.unit}
            peerValue={peerValue}
            isQuarterly={effectiveIsQuarterly}
          />
        </div>
      )}

      {/* 圖表區 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 多年疊合趨勢圖 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-bold text-gray-800 mb-4">多年疊合趨勢</h2>
          <YearOverlayChart
            monthlyData={monthlyData}
            yearlySummaries={yearlySummaries}
            unit={meta.unit}
            benchmarkValue={primaryBenchmark}
            isQuarterly={effectiveIsQuarterly}
          />
        </div>

        {/* 年度比較 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-bold text-gray-800 mb-4">年度平均值比較</h2>
          <YearCompareBar yearlySummaries={yearlySummaries} unit={meta.unit} />
        </div>
      </div>

      {/* 標竿比較 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">標竿比較</h2>
        <BenchmarkBar
          latestValue={latestValue}
          yearlySummaries={yearlySummaries}
          unit={meta.unit}
          peerValue={peerValue}
          peerYear={peerYear}
          campus={campus}
        />
      </div>

      {/* 完整數據表 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">完整數據</h2>
        <DataTable monthlyData={monthlyData} unit={meta.unit} isQuarterly={effectiveIsQuarterly} />
      </div>

      {/* AI 深度分析 */}
      <AIAnalysisPanel
        promptInput={{
          meta,
          campus,
          latestValue,
          latestMonth,
          status,
          trend,
          peerValue,
          peerYear,
          benchmarkValue,
          controlChart,
          anomalies,
          monthlyData: rawMonthlyData,
          yearlySummaries,
        } satisfies PromptInput}
        cacheKey={`${meta.code}_${campus}_${latestMonth ?? 'nodate'}`}
      />
    </div>
  );
}

/* ---- 可摺疊異常面板 ---- */
import { AnomalyResult } from '@/lib/types';

function AnomalyPanel({ anomalies, isQuarterly = false }: { anomalies: AnomalyResult[]; isQuarterly?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const previewCount = 3;

  // 按年月降序排列（最新在最上面）
  const sorted = [...anomalies].sort((a, b) => {
    const ya = a.year ?? 0, yb = b.year ?? 0;
    if (ya !== yb) return yb - ya;
    return (b.month ?? 0) - (a.month ?? 0);
  });

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
              const mechanismIcon = a.mechanism === 'control_chart' ? <TrendingUp size={14} /> :
                a.mechanism === 'peer_comparison' ? <Users size={14} /> :
                <AlertTriangle size={14} />;
              const mechanismLabel = a.mechanism === 'control_chart' ? '管制圖' :
                a.mechanism === 'monthly_change' ? '月增減' : '同儕比較';
              const statusConf = STATUS_CONFIG[a.severity];

              // 季指標：月份 → 季度顯示
              const periodLabel = a.year && a.month
                ? isQuarterly
                  ? `${a.year}年Q${Math.ceil(a.month / 3)}`
                  : `${a.year}年${a.month}月`
                : '';

              return (
                <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${statusConf.bgLight}`}>
                  <span className={statusConf.textColor}>{mechanismIcon}</span>
                  {periodLabel && (
                    <span className="text-xs text-gray-500 shrink-0 font-mono w-20">
                      {periodLabel}
                    </span>
                  )}
                  <span className={`text-xs font-medium ${statusConf.textColor} shrink-0`}>{mechanismLabel}</span>
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
