/**
 * Django REST API Client
 *
 * 取代 Dexie/IndexedDB 的資料層，改從 Django REST API 取得資料。
 * 所有元件仍使用相同的 IndicatorData 型別，只是資料來源改變。
 */

import type {
  Campus,
  Category,
  IndicatorData,
  IndicatorMeta,
  IndicatorStatus,
  TrendDirection,
  MonthlyDataPoint,
  YearlySummary,
  ControlChartParams,
  AnomalyResult,
  DataNature,
  Direction,
  IndicatorUnit,
} from './types';
import { INDICATOR_META } from './constants';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

// ── Static JSON base path (GitHub Pages) ──
// In demo mode, load pre-exported JSON from /data/ instead of hitting the API

function getBasePath(): string {
  // Next.js injects basePath at build time via __NEXT_DATA__
  if (typeof window === 'undefined') return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextData = (window as any).__NEXT_DATA__;
  return nextData?.basePath || '';
}

async function staticFetch<T>(path: string): Promise<T> {
  const basePath = getBasePath();
  const res = await fetch(`${basePath}${path}`);
  if (!res.ok) throw new Error(`Static data not found: ${path}`);
  return res.json();
}

// ── Generic fetch wrapper ──

async function apiFetch<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${await res.text()}`);
    }
    return res.json();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('API 連線逾時（30秒），請確認後端是否正在運行');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Dashboard bulk load ──

interface DashboardItem {
  code: string;
  name: string;
  category: string;
  unit: string;
  direction: string;
  data_nature: string;
  is_quarterly: boolean;
  latest_value: number | null;
  latest_period: string | null;
  sparkline: (number | null)[];
  monthly_data: { year: number; month: number; value: number | null }[];
  status: string;
  mechanisms: string[];
  unfavorable_count: number;
  year_avg: number | null;
  year_label: string | null;
  peer_value: number | null;
  peer_source: string | null;
  trend: string;
  latest_anomalies: { mechanism: string; severity: string; message: string }[];
}

interface DashboardResponse {
  data: DashboardItem[];
  total: number;
  campus: string;
}

/**
 * 從 Django API 批次載入儀表板資料。
 * 將 Django 回應轉換為前端的 IndicatorData[] 格式。
 */
export async function loadDashboardFromAPI(campus: Campus): Promise<IndicatorData[]> {
  const resp = IS_DEMO
    ? await staticFetch<DashboardResponse>(`/data/dashboard-${campus}.json`)
    : await apiFetch<DashboardResponse>(
        `/api/v1/dashboard/?campus=${encodeURIComponent(campus)}`
      );

  return resp.data.map(item => {
    const meta = INDICATOR_META[item.code];
    const indicatorMeta: IndicatorMeta = {
      code: item.code,
      name: item.name,
      category: item.category as Category,
      unit: item.unit as IndicatorUnit,
      isQuarterly: item.is_quarterly,
      direction: item.direction as Direction,
      campuses: meta?.campuses || [campus],
      source: 'preset',
      aliases: meta?.aliases || [],
      isActive: true,
      dataNature: item.data_nature as DataNature,
      isReverse: item.direction === 'lower',
    };

    // Build monthlyData from API (with real year/month for matrix view)
    const monthlyData: MonthlyDataPoint[] = (item.monthly_data || []).map(dp => ({
      year: dp.year,
      month: dp.month,
      value: dp.value,
    }));

    // Build yearly summaries placeholder
    const yearlySummaries: YearlySummary[] = [];
    if (item.year_label && item.year_avg !== null) {
      yearlySummaries.push({
        year: parseInt(item.year_label),
        average: item.year_avg,
        benchmarkRegional: null,
        benchmarkDistrict: null,
      });
    }

    return {
      meta: indicatorMeta,
      campus,
      monthlyData,
      yearlySummaries,
      latestValue: item.latest_value,
      latestMonth: item.latest_period,
      status: item.status as IndicatorStatus,
      trend: item.trend as TrendDirection,
      benchmarkValue: item.peer_value,
      peerValue: item.peer_value,
      peerYear: null,
      anomalies: (item.latest_anomalies || []).map(a => ({
        mechanism: a.mechanism as AnomalyResult['mechanism'],
        severity: a.severity as IndicatorStatus,
        direction: 'unfavorable' as const,
        message: a.message,
        value: item.latest_value ?? 0,
        year: item.latest_period ? parseInt(item.latest_period.split('.')[0]) : undefined,
        month: item.latest_period ? parseInt(item.latest_period.split('.')[1]) : undefined,
      })),
      controlChart: null,
    };
  });
}

// ── Indicator detail data ──

interface DataPointResponse {
  data: { year: number; month: number; value: number | null; numerator: number | null; denominator: number | null }[];
  total: number;
}

interface SummaryResponse {
  data: { year: number; average: number | null; benchmark_regional: number | null; benchmark_district: number | null }[];
  tcpi: { year: number; medical_center: number | null; regional_hospital: number | null; district_hospital: number | null }[];
  total: number;
}

/**
 * 載入單一指標的完整月份資料（用於詳情頁）
 */
export async function loadIndicatorData(code: string, campus: Campus): Promise<MonthlyDataPoint[]> {
  let resp: DataPointResponse;
  if (IS_DEMO) {
    const detail = await staticFetch<{ data: DataPointResponse }>(`/data/detail/${code}-${campus}.json`);
    resp = detail.data;
  } else {
    resp = await apiFetch<DataPointResponse>(
      `/api/v1/indicators/${code}/data/?campus=${encodeURIComponent(campus)}`
    );
  }
  return resp.data.map(dp => ({
    year: dp.year,
    month: dp.month,
    value: dp.value,
    numerator: dp.numerator ?? undefined,
    denominator: dp.denominator ?? undefined,
  }));
}

/**
 * 載入年度摘要（含標竿值）
 */
export async function loadIndicatorSummaries(code: string, campus: Campus): Promise<{
  summaries: YearlySummary[];
  peerValue: number | null;
}> {
  let resp: SummaryResponse;
  if (IS_DEMO) {
    const detail = await staticFetch<{ summaries: SummaryResponse }>(`/data/detail/${code}-${campus}.json`);
    resp = detail.summaries;
  } else {
    resp = await apiFetch<SummaryResponse>(
      `/api/v1/indicators/${code}/summaries/?campus=${encodeURIComponent(campus)}`
    );
  }

  const summaries: YearlySummary[] = resp.data.map(s => ({
    year: s.year,
    average: s.average,
    benchmarkRegional: s.benchmark_regional,
    benchmarkDistrict: s.benchmark_district,
  }));

  // Extract peer value from TCPI or benchmarks
  let peerValue: number | null = null;
  if (resp.tcpi.length > 0) {
    const latest = resp.tcpi[0]; // Already sorted by -year
    if (campus === '新竹') peerValue = latest.medical_center;
    else if (campus === '竹北') peerValue = latest.regional_hospital;
    else if (campus === '竹東') peerValue = latest.district_hospital;
  }
  if (peerValue === null && summaries.length > 0) {
    const latest = summaries[summaries.length - 1];
    if (campus === '竹北') peerValue = latest.benchmarkRegional;
    else if (campus === '竹東') peerValue = latest.benchmarkDistrict ?? latest.benchmarkRegional;
  }

  return { summaries, peerValue };
}

// ── Analysis API ──

interface AnalysisResponse {
  status: string;
  anomalies: {
    mechanism: string;
    severity: string;
    direction: string;
    message: string;
    value: number;
    rule: string;
    reference_value: number | null;
    year: number | null;
    month: number | null;
  }[];
  control_chart: {
    chart_type: string;
    cl: number;
    ucl: number;
    lcl: number;
    sigma: number;
    ucl2: number;
    lcl2: number;
    n: number;
    variable_limits: {
      year: number;
      month: number;
      ucl: number;
      lcl: number;
      ucl2: number;
      lcl2: number;
      sample_size: number;
    }[];
  } | null;
  peer_value: number | null;
}

/**
 * 從 Django API 取得即時分析結果（管制圖 + 異常偵測）
 */
export async function loadAnalysis(code: string, campus: Campus, period?: 'monthly' | 'quarterly'): Promise<{
  status: IndicatorStatus;
  anomalies: AnomalyResult[];
  controlChart: ControlChartParams | null;
  peerValue: number | null;
}> {
  let resp: AnalysisResponse;
  if (IS_DEMO) {
    const detail = await staticFetch<{ analysis: AnalysisResponse }>(`/data/detail/${code}-${campus}.json`);
    resp = detail.analysis;
  } else {
    const periodParam = period === 'quarterly' ? '&period=quarterly' : '';
    resp = await apiFetch<AnalysisResponse>(
      `/api/v1/indicators/${code}/analysis/?campus=${encodeURIComponent(campus)}${periodParam}`
    );
  }

  const anomalies: AnomalyResult[] = resp.anomalies.map(a => ({
    mechanism: a.mechanism as AnomalyResult['mechanism'],
    rule: a.rule || undefined,
    severity: a.severity as IndicatorStatus,
    direction: a.direction as 'unfavorable' | 'favorable',
    message: a.message,
    value: a.value,
    referenceValue: a.reference_value ?? undefined,
    year: a.year ?? undefined,
    month: a.month ?? undefined,
  }));

  let controlChart: ControlChartParams | null = null;
  if (resp.control_chart) {
    const cc = resp.control_chart;
    controlChart = {
      chartType: cc.chart_type as ControlChartParams['chartType'],
      cl: cc.cl,
      ucl: cc.ucl,
      lcl: cc.lcl,
      sigma: cc.sigma,
      ucl2: cc.ucl2,
      lcl2: cc.lcl2,
      n: cc.n,
      variableLimits: cc.variable_limits.map(vl => ({
        year: vl.year,
        month: vl.month,
        ucl: vl.ucl,
        lcl: vl.lcl,
        ucl2: vl.ucl2,
        lcl2: vl.lcl2,
        sampleSize: vl.sample_size,
      })),
    };
  }

  return {
    status: resp.status as IndicatorStatus,
    anomalies,
    controlChart,
    peerValue: resp.peer_value,
  };
}

// ── Import API ──

interface ImportResponse {
  data: {
    id: number;
    new: number;
    updated: number;
    unchanged: number;
    sheets: string[];
    errors: string[];
  };
}

/**
 * 上傳 Excel 檔案到 Django API
 */
export async function uploadExcel(file: File): Promise<ImportResponse['data']> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/api/v1/imports/upload/`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }

  const resp: ImportResponse = await res.json();
  return resp.data;
}
