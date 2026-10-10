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
  ImportLog,
  MonthlyAlert,
  TCPIBenchmark,
} from './types';
import { INDICATOR_META } from './constants';
import { request } from './http';

// ── Generic GET wrapper ──
// Transport (cookies, CSRF, 30s GET timeout, error parsing) lives in lib/http.ts.

function apiFetch<T>(path: string): Promise<T> {
  return request<T>(path);
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
  monthly_data: { year: number; month: number; value: number | null; numerator?: number | null; denominator?: number | null }[];
  status: string;
  mechanisms: string[];
  unfavorable_count: number;
  year_avg: number | null;
  year_label: string | null;
  peer_value: number | null;
  peer_source: string | null;
  trend: string;
  latest_anomalies: { mechanism: string; severity: string; message: string }[];
  monthly_alerts: { year: number; month: number; severity: string; mechanism: string }[];
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
  const resp = await apiFetch<DashboardResponse>(
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
      numerator: dp.numerator ?? undefined,
      denominator: dp.denominator ?? undefined,
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
      peerSource: (item.peer_source === 'TCPI' || item.peer_source === 'peer') ? item.peer_source : null,
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
      monthlyAlerts: (item.monthly_alerts || []).map(a => ({
        year: a.year,
        month: a.month,
        severity: a.severity as MonthlyAlert['severity'],
        mechanism: a.mechanism as AnomalyResult['mechanism'],
      })),
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
  const resp = await apiFetch<DataPointResponse>(
    `/api/v1/indicators/${code}/data/?campus=${encodeURIComponent(campus)}`
  );
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
  const resp = await apiFetch<SummaryResponse>(
    `/api/v1/indicators/${code}/summaries/?campus=${encodeURIComponent(campus)}`
  );

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
    target_mode?: boolean;
    target_value?: number | null;
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
  const periodParam = period === 'quarterly' ? '&period=quarterly' : '';
  const resp = await apiFetch<AnalysisResponse>(
    `/api/v1/indicators/${code}/analysis/?campus=${encodeURIComponent(campus)}${periodParam}`
  );

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
      targetMode: cc.target_mode ?? false,
      targetValue: cc.target_value ?? null,
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

// ── Indicator meta (with target settings) ──

/** Indicator as serialized by the backend (shared by the list and detail endpoints). */
export interface IndicatorMetaResponse {
  code: string;
  name: string;
  category: string;
  unit: string;
  direction: string;
  data_nature: string;
  is_quarterly: boolean;
  is_active: boolean;
  campuses: string[];
  aliases: string[];
  formula: string;
  description: string;
  target_mode: boolean;
  target_value: number | null;
}

export interface IndicatorTargetState {
  targetMode: boolean;
  targetValue: number | null;
}

export async function loadIndicatorMeta(code: string): Promise<IndicatorTargetState> {
  const resp = await apiFetch<IndicatorMetaResponse>(`/api/v1/indicators/${code}/`);
  return { targetMode: resp.target_mode, targetValue: resp.target_value };
}

export async function updateIndicatorTarget(
  code: string,
  payload: { targetMode: boolean; targetValue: number | null },
): Promise<IndicatorTargetState> {
  const data = await request<IndicatorMetaResponse>(`/api/v1/indicators/${code}/`, {
    method: 'PATCH',
    json: {
      target_mode: payload.targetMode,
      target_value: payload.targetValue,
    },
  });
  return { targetMode: data.target_mode, targetValue: data.target_value };
}

/**
 * GET /api/v1/indicators/ — all active indicators (used by the assignment admin page).
 * The backend answers `{ data, total }`; a bare array is accepted too.
 */
export async function listIndicators(): Promise<IndicatorMetaResponse[]> {
  const resp = await apiFetch<IndicatorMetaResponse[] | { data?: IndicatorMetaResponse[] }>(
    '/api/v1/indicators/'
  );
  return Array.isArray(resp) ? resp : (resp.data ?? []);
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
  const form = new FormData();
  form.append('file', file);

  const resp = await request<ImportResponse>('/api/v1/imports/upload/', {
    method: 'POST',
    form,
  });
  return resp.data;
}

interface ImportLogResponse {
  data: {
    id: number;
    file_name: string;
    file_size: number;
    sheets_processed: string[] | null;
    data_points_new: number;
    data_points_updated: number;
    data_points_unchanged: number;
    errors: string[] | null;
    created_at: string;
  }[];
  total: number;
}

/**
 * GET /api/v1/imports/logs/ — latest import logs (newest first, max 20),
 * mapped to the front-end ImportLog shape.
 */
export async function getImportLogs(): Promise<ImportLog[]> {
  const resp = await apiFetch<ImportLogResponse>('/api/v1/imports/logs/');
  return (resp.data || []).map(log => ({
    id: log.id,
    timestamp: new Date(log.created_at),
    fileName: log.file_name,
    fileSize: log.file_size,
    sheetsProcessed: log.sheets_processed || [],
    dataPointsNew: log.data_points_new,
    dataPointsUpdated: log.data_points_updated,
    dataPointsUnchanged: log.data_points_unchanged,
    revisionsDetected: 0,
    errors: log.errors || [],
  }));
}

export interface CorrectDatapointPayload {
  indicator_code: string;
  campus: string;
  year: number;
  month: number;
  /** null = keep the stored value and only drop the warning from the log. */
  new_value: number | null;
  log_id: number;
  /** Exact warning text to remove from the import log's errors. */
  error_text: string;
}

/** POST /api/v1/imports/correct-datapoint/ — fix one warned data point and clear its warning. */
export async function correctDatapoint(payload: CorrectDatapointPayload): Promise<void> {
  await request<void>('/api/v1/imports/correct-datapoint/', {
    method: 'POST',
    json: payload,
    responseType: 'void',
  });
}

// ── TCPI benchmarks ──

export interface SaveTcpiBenchmarksPayload {
  benchmarks: TCPIBenchmark[];
}

/** POST /api/v1/tcpi/ — replaces all stored TCPI benchmarks; `saved` = rows kept after matching indicator codes. */
export async function saveTcpiBenchmarks(
  payload: SaveTcpiBenchmarksPayload
): Promise<{ saved: number; total: number }> {
  return request<{ saved: number; total: number }>('/api/v1/tcpi/', {
    method: 'POST',
    json: payload,
  });
}
